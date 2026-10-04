import { getGasAssistBaseUrl } from './gasAssist.js'
import { gasAssistTrace, gasAssistTraceError } from './gasAssistTrace.js'

const sessions = new Map()
const orderPolls = new Map()
const SPONSORSHIP_ORDER_MIN_POLL_MS = 5_000
const SPONSORSHIP_ORDER_RATE_LIMIT_BACKOFF_MS = 15_000
const SPONSORSHIP_BROWSER_STATE_TTL_MS = 15 * 60_000

function requestPath(url) {
    try {
        return new URL(url, globalThis.location?.origin ?? 'http://localhost').pathname
    } catch {
        return String(url).split('?')[0]
    }
}

function sponsorshipError(code, message, details = {}) {
    const error = new Error(message)
    error.code = code
    error.details = details
    if (details.status !== undefined) error.status = details.status
    if (details.requestId) error.requestId = details.requestId
    if (details.stage) error.stage = details.stage
    if (details.retryAfterMs !== undefined) error.retryAfterMs = details.retryAfterMs
    return error
}

function responseRetryAfterMs(response) {
    const raw = response?.headers?.get?.('retry-after')
    if (!raw) return undefined
    const seconds = Number(raw)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000)
    const at = Date.parse(raw)
    if (!Number.isFinite(at)) return undefined
    return Math.max(0, at - Date.now())
}

async function requestJson(url, options = {}, stage = 'sponsorship.request') {
    const startedAt = Date.now()
    const method = String(options.method ?? 'GET').toUpperCase()
    const path = requestPath(url)
    gasAssistTrace('http.request.start', { stage, method, path })

    let response
    try {
        response = await fetch(url, options)
    } catch (cause) {
        const error = sponsorshipError(
            cause?.name === 'AbortError' ? 'SPONSORSHIP_REQUEST_ABORTED' : 'SPONSORSHIP_NETWORK_ERROR',
            cause?.name === 'AbortError'
                ? 'The Gas Assist request was cancelled.'
                : 'Could not reach the Gas Assist service.',
            { stage, method, path, elapsedMs: Date.now() - startedAt },
        )
        gasAssistTraceError('http.request.error', error, { stage, method, path })
        throw error
    }

    const requestId = response.headers.get('x-request-id') ??
        response.headers.get('x-correlation-id') ?? undefined
    const text = await response.text()
    let payload = null
    if (text) {
        try {
            payload = JSON.parse(text)
        } catch {
            const gatewayTimeout = [502, 503, 504].includes(response.status)
            throw sponsorshipError(
                gatewayTimeout ? 'CROSS_CHAIN_GATEWAY_TIMEOUT' : 'SPONSORSHIP_INVALID_RESPONSE',
                gatewayTimeout
                    ? 'Gas Assist took too long to confirm this route. Try again.'
                    : 'Gas Assist returned an unreadable response.',
                { stage, method, path, status: response.status, requestId },
            )
        }
    }

    if (!response.ok) {
        const gatewayTimeout = !payload?.error?.code && [502, 503, 504].includes(response.status)
        const error = sponsorshipError(
            gatewayTimeout ? 'CROSS_CHAIN_GATEWAY_TIMEOUT' : payload?.error?.code ?? 'SPONSORSHIP_FAILED',
            payload?.error?.message ?? `Gas Assist request failed with HTTP ${response.status}.`,
            {
                stage,
                method,
                path,
                status: response.status,
                requestId,
                retryAfterMs: responseRetryAfterMs(response),
                backendDetails: payload?.error?.details,
            },
        )
        gasAssistTraceError('http.request.error', error, { stage, method, path })
        throw error
    }

    if (payload === null) {
        throw sponsorshipError(
            'SPONSORSHIP_EMPTY_RESPONSE',
            'Gas Assist returned an empty response.',
            { stage, method, path, status: response.status, requestId },
        )
    }

    gasAssistTrace('http.request.success', {
        stage,
        method,
        path,
        status: response.status,
        requestId,
        elapsedMs: Date.now() - startedAt,
    })
    return payload
}

function post(quoteEndpoint, path, body, {
    sessionToken,
    idempotencyKey,
    signal,
    stage = 'sponsorship.post',
} = {}) {
    return requestJson(`${getGasAssistBaseUrl(quoteEndpoint)}${path}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
            ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
        body: JSON.stringify(body ?? {}),
        signal,
    }, stage)
}

function deleteExpiredSessions(now = Date.now()) {
    for (const [key, session] of sessions) {
        if (!Number.isFinite(Date.parse(session?.expiresAt)) || Date.parse(session.expiresAt) <= now) {
            sessions.delete(key)
        }
    }
}

function orderPollKey(quoteEndpoint, sessionToken, orderId) {
    return `${getGasAssistBaseUrl(quoteEndpoint)}:${orderId}:${sessionToken}`
}

function pruneOrderPolls(now = Date.now()) {
    for (const [key, state] of orderPolls) {
        if (now - Number(state?.lastTouchedAt ?? 0) > SPONSORSHIP_BROWSER_STATE_TTL_MS) {
            orderPolls.delete(key)
        }
    }
}

function awaitSharedRequest(promise, signal) {
    if (!signal) return promise
    if (signal.aborted) {
        return Promise.reject(sponsorshipError(
            'SPONSORSHIP_REQUEST_ABORTED',
            'The Gas Assist request was cancelled.',
            { stage: 'order.poll' },
        ))
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            cleanup()
            reject(sponsorshipError(
                'SPONSORSHIP_REQUEST_ABORTED',
                'The Gas Assist request was cancelled.',
                { stage: 'order.poll' },
            ))
        }
        const cleanup = () => signal.removeEventListener('abort', onAbort)
        signal.addEventListener('abort', onAbort, { once: true })
        promise.then(
            (value) => {
                cleanup()
                resolve(value)
            },
            (error) => {
                cleanup()
                reject(error)
            },
        )
    })
}

export async function fetchSponsorshipConfig(quoteEndpoint, signal, chainId = 56) {
    return requestJson(
        `${getGasAssistBaseUrl(quoteEndpoint)}/v1/sponsorship/config?sourceChainId=${Number(chainId)}`,
        { signal },
        'config.fetch',
    )
}

export async function authenticateSponsorshipWallet({
    quoteEndpoint,
    walletAddress,
    walletClient,
    chainId = walletClient?.chain?.id ?? 56,
    signal,
}) {
    deleteExpiredSessions()
    const key = `${getGasAssistBaseUrl(quoteEndpoint)}:${chainId}:${walletAddress.toLowerCase()}`
    const existing = sessions.get(key)
    if (existing && Date.parse(existing.expiresAt) > Date.now() + 5_000) return existing
    if (typeof walletClient?.signMessage !== 'function') {
        throw sponsorshipError(
            'WALLET_MESSAGE_SIGNING_UNAVAILABLE',
            'The connected wallet cannot authenticate Gas Assist.',
            { stage: 'auth.sign-message' },
        )
    }

    const challenge = await post(quoteEndpoint, '/v1/sponsorship/auth/challenge', {
        walletAddress,
        chainId,
    }, { signal, stage: 'auth.challenge' })
    if (Number(challenge?.chainId ?? chainId) !== Number(chainId) || !challenge?.challengeId || typeof challenge.message !== 'string' || !challenge.message) {
        throw sponsorshipError(
            'SPONSORSHIP_INVALID_CHALLENGE',
            'Gas Assist returned an invalid authentication challenge.',
            { stage: 'auth.challenge' },
        )
    }

    const signature = await walletClient.signMessage({
        account: walletAddress,
        message: challenge.message,
    })
    const session = await post(quoteEndpoint, '/v1/sponsorship/auth/verify', {
        challengeId: challenge.challengeId,
        signature,
    }, { signal, stage: 'auth.verify' })
    if (Number(session?.chainId ?? chainId) !== Number(chainId) || !session?.sessionToken || !Number.isFinite(Date.parse(session.expiresAt))) {
        throw sponsorshipError(
            'SPONSORSHIP_INVALID_SESSION',
            'Gas Assist returned an invalid authenticated session.',
            { stage: 'auth.verify' },
        )
    }
    sessions.set(key, session)
    return session
}

export function createSponsorshipOrder(
    quoteEndpoint,
    sessionToken,
    request,
    idempotencyKey,
    signal,
) {
    const allowed = new Set(['sellToken', 'buyToken', 'grossInputAmount', 'slippageBps'])
    if (!request || Object.keys(request).some((key) => !allowed.has(key)) ||
        [...allowed].some((key) => !(key in request))) {
        throw sponsorshipError(
            'SPONSORSHIP_ORDER_INVALID',
            'Sponsorship order requests contain unsupported or missing fields.',
            { stage: 'order.create' },
        )
    }
    if (!idempotencyKey) {
        throw sponsorshipError(
            'SPONSORSHIP_IDEMPOTENCY_KEY_REQUIRED',
            'A sponsorship idempotency key is required.',
            { stage: 'order.create' },
        )
    }
    return post(quoteEndpoint, '/v1/sponsorship/orders', request, {
        sessionToken,
        idempotencyKey,
        signal,
        stage: 'order.create',
    })
}

export async function fetchSponsorshipOrder(
    quoteEndpoint,
    sessionToken,
    orderId,
    signal,
) {
    pruneOrderPolls()
    const key = orderPollKey(quoteEndpoint, sessionToken, orderId)
    const now = Date.now()
    let state = orderPolls.get(key)
    if (!state) {
        state = {
            inFlight: null,
            lastOrder: null,
            lastFetchedAt: 0,
            backoffUntil: 0,
            lastTouchedAt: now,
        }
        orderPolls.set(key, state)
    }
    state.lastTouchedAt = now

    const cacheFreshUntil = state.lastFetchedAt + SPONSORSHIP_ORDER_MIN_POLL_MS
    const reuseUntil = Math.max(cacheFreshUntil, state.backoffUntil)
    if (state.lastOrder && now < reuseUntil) {
        gasAssistTrace('order.poll.cached', {
            orderId,
            remainingMs: Math.max(0, reuseUntil - now),
            rateLimited: now < state.backoffUntil,
        })
        return state.lastOrder
    }

    if (!state.inFlight) {
        state.inFlight = requestJson(
            `${getGasAssistBaseUrl(quoteEndpoint)}/v1/sponsorship/orders/${encodeURIComponent(orderId)}`,
            { headers: { authorization: `Bearer ${sessionToken}` } },
            'order.poll',
        )
            .then((order) => {
                state.lastOrder = order
                state.lastFetchedAt = Date.now()
                state.backoffUntil = 0
                return order
            })
            .catch((error) => {
                if (error?.code === 'RATE_LIMITED' || error?.status === 429) {
                    const backoffMs = Math.max(
                        SPONSORSHIP_ORDER_RATE_LIMIT_BACKOFF_MS,
                        Number(error?.retryAfterMs ?? 0),
                    )
                    state.backoffUntil = Date.now() + backoffMs
                    gasAssistTrace('order.poll.rate-limited', { orderId, backoffMs })
                    if (state.lastOrder) return state.lastOrder
                }
                throw error
            })
            .finally(() => {
                state.inFlight = null
                state.lastTouchedAt = Date.now()
            })
    } else {
        gasAssistTrace('order.poll.joined', { orderId })
    }

    return awaitSharedRequest(state.inFlight, signal)
}

export const prepaidSponsorshipInternals = {
    SPONSORSHIP_BROWSER_STATE_TTL_MS,
    SPONSORSHIP_ORDER_MIN_POLL_MS,
    SPONSORSHIP_ORDER_RATE_LIMIT_BACKOFF_MS,
    clearOrderPolls: () => orderPolls.clear(),
    clearSessions: () => sessions.clear(),
    deleteExpiredSessions,
    requestJson,
    sponsorshipError,
}
