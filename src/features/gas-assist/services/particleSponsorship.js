import { getGasAssistBaseUrl } from './gasAssist.js'
import { gasAssistTrace, gasAssistTraceError } from './gasAssistTrace.js'

const sessions = new Map()
const directResults = new Map()
const directFailures = new Map()
const orderPolls = new Map()
const ADDRESS = /^0x[0-9a-f]{40}$/iu
const HEX = /^0x(?:[0-9a-f]{2})*$/iu
const PARTICLE_PAYMASTER_POLL_MS = 2_000
const PARTICLE_RATE_LIMIT_BACKOFF_MS = 5_000
const SPONSORSHIP_ORDER_MIN_POLL_MS = 5_000
const SPONSORSHIP_ORDER_RATE_LIMIT_BACKOFF_MS = 15_000
const PARTICLE_BROWSER_STATE_TTL_MS = 15 * 60_000

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
        throw sponsorshipError('SPONSORSHIP_EMPTY_RESPONSE', 'Gas Assist returned an empty response.', {
            stage, method, path, status: response.status, requestId,
        })
    }
    gasAssistTrace('http.request.success', {
        stage, method, path, status: response.status, requestId, elapsedMs: Date.now() - startedAt,
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

function validDirectCall(call) {
    if (!call || typeof call !== 'object' || Array.isArray(call)) return false
    if (!ADDRESS.test(String(call.to ?? ''))) return false
    if (!HEX.test(String(call.data ?? ''))) return false
    try {
        return BigInt(String(call.value ?? '0')) === 0n
    } catch {
        return false
    }
}

function validateParticlePrepared(prepared, orderId) {
    if (
        !prepared ||
        prepared.provider !== 'particle' ||
        prepared.execution !== 'particle-universal-7702-direct' ||
        Number(prepared.chainId) !== 56 ||
        prepared.orderId !== orderId ||
        prepared.stage !== 'direct' ||
        prepared.paymentMode !== 'sponsored' ||
        !Number.isFinite(Date.parse(prepared.expiresAt)) ||
        Date.parse(prepared.expiresAt) <= Date.now() ||
        !Array.isArray(prepared.transactions) ||
        prepared.transactions.length !== 5 ||
        !prepared.transactions.every(validDirectCall) ||
        !['pending', 'approved'].includes(prepared.paymasterApproval)
    ) {
        throw sponsorshipError(
            'PARTICLE_DIRECT_INTENT_INVALID',
            'Gas Assist returned an invalid direct Particle sponsorship intent.',
            { stage: 'atomic.prepare' },
        )
    }
    return prepared
}

function activeParticleBrowserFailure(orderId, now = Date.now()) {
    const failure = directFailures.get(orderId)
    if (!failure) return null
    if (now - failure.recordedAt > PARTICLE_BROWSER_STATE_TTL_MS) {
        directFailures.delete(orderId)
        return null
    }
    return failure
}

function orderPollKey(quoteEndpoint, sessionToken, orderId) {
    return `${getGasAssistBaseUrl(quoteEndpoint)}:${orderId}:${sessionToken}`
}

function invalidateOrderPoll(quoteEndpoint, sessionToken, orderId) {
    orderPolls.delete(orderPollKey(quoteEndpoint, sessionToken, orderId))
}

function pruneOrderPolls(now = Date.now()) {
    for (const [key, state] of orderPolls) {
        if (now - Number(state?.lastTouchedAt ?? 0) > PARTICLE_BROWSER_STATE_TTL_MS) {
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

function applyParticleBrowserState(order, orderId) {
    const failure = activeParticleBrowserFailure(orderId)
    if (failure) {
        return {
            ...order,
            status: 'failed',
            safeErrorCode: failure.safeErrorCode,
            atomicExecution: {
                ...(order.atomicExecution ?? {}),
                provider: 'particle',
                execution: 'particle-universal-7702-direct',
                stage: 'failed',
                providerStatus: 'browser-execution-failed',
            },
        }
    }

    const direct = directResults.get(orderId)
    if (!direct) return order
    if (Date.now() - direct.recordedAt > PARTICLE_BROWSER_STATE_TTL_MS) {
        directResults.delete(orderId)
        return order
    }
    if (direct.particleStatus === 'success') {
        return {
            ...order,
            status: 'completed',
            particleTransactionId: direct.transactionId,
            atomicExecution: {
                ...(order.atomicExecution ?? {}),
                provider: 'particle',
                execution: 'particle-universal-7702-direct',
                stage: 'confirmed',
                paymasterApproval: 'approved',
                providerStatus: 'confirmed-in-browser',
            },
        }
    }
    return {
        ...order,
        status: 'atomic-submitted',
        particleTransactionId: direct.transactionId,
        atomicExecution: {
            ...(order.atomicExecution ?? {}),
            provider: 'particle',
            execution: 'particle-universal-7702-direct',
            stage: 'submitted',
            paymasterApproval: 'approved',
            providerStatus: direct.particleStatus,
        },
    }
}

export async function fetchSponsorshipConfig(quoteEndpoint, signal) {
    const payload = await requestJson(
        `${getGasAssistBaseUrl(quoteEndpoint)}/v1/sponsorship/config`,
        { signal },
        'config.fetch',
    )
    return payload?.enabled === true
        ? { ...payload, provider: 'particle', atomicExecution: true, execution: 'browser-direct' }
        : payload
}

export async function authenticateSponsorshipWallet({
    quoteEndpoint,
    walletAddress,
    walletClient,
    signal,
}) {
    deleteExpiredSessions()
    const key = `${getGasAssistBaseUrl(quoteEndpoint)}:${walletAddress.toLowerCase()}`
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
        chainId: 56,
    }, { signal, stage: 'auth.challenge' })
    if (!challenge?.challengeId || typeof challenge.message !== 'string' || !challenge.message) {
        throw sponsorshipError(
            'SPONSORSHIP_INVALID_CHALLENGE',
            'Gas Assist returned an invalid authentication challenge.',
            { stage: 'auth.challenge' },
        )
    }
    const signature = await walletClient.signMessage({ account: walletAddress, message: challenge.message })
    const session = await post(quoteEndpoint, '/v1/sponsorship/auth/verify', {
        challengeId: challenge.challengeId,
        signature,
    }, { signal, stage: 'auth.verify' })
    if (!session?.sessionToken || !Number.isFinite(Date.parse(session.expiresAt))) {
        throw sponsorshipError(
            'SPONSORSHIP_INVALID_SESSION',
            'Gas Assist returned an invalid authenticated session.',
            { stage: 'auth.verify' },
        )
    }
    sessions.set(key, session)
    return session
}

export function createSponsorshipOrder(quoteEndpoint, sessionToken, request, idempotencyKey, signal) {
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
        sessionToken, idempotencyKey, signal, stage: 'order.create',
    })
}

export async function prepareAtomicSponsorship(quoteEndpoint, sessionToken, orderId, signal) {
    directFailures.delete(orderId)
    invalidateOrderPoll(quoteEndpoint, sessionToken, orderId)
    try {
        return validateParticlePrepared(await post(
            quoteEndpoint,
            `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/atomic/prepare`,
            {},
            { sessionToken, signal, stage: 'atomic.prepare' },
        ), orderId)
    } finally {
        // Preparing mutates the order's sponsorship state. Never retain a cached
        // pre-prepare status across this boundary.
        invalidateOrderPoll(quoteEndpoint, sessionToken, orderId)
    }
}

export function recordParticleBrowserResult(orderId, result) {
    if (!orderId || !result?.transactionId) return
    directFailures.delete(orderId)
    directResults.set(orderId, {
        transactionId: String(result.transactionId),
        particleStatus: String(result.particleStatus ?? 'submitted'),
        recordedAt: Date.now(),
    })
}

export function recordParticleBrowserFailure(orderId, error) {
    if (!orderId) return
    directResults.delete(orderId)
    directFailures.set(orderId, {
        safeErrorCode: String(error?.code ?? 'PARTICLE_BROWSER_EXECUTION_FAILED'),
        recordedAt: Date.now(),
    })
    gasAssistTrace('signing.particle.browser-failure-recorded', {
        orderId,
        code: String(error?.code ?? 'PARTICLE_BROWSER_EXECUTION_FAILED'),
    })
}

export async function fetchSponsorshipOrder(quoteEndpoint, sessionToken, orderId, signal) {
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
        return applyParticleBrowserState(state.lastOrder, orderId)
    }

    if (!state.inFlight) {
        const request = requestJson(
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
        state.inFlight = request
    } else {
        gasAssistTrace('order.poll.joined', { orderId })
    }

    const order = await awaitSharedRequest(state.inFlight, signal)
    return applyParticleBrowserState(order, orderId)
}

function wait(ms) {
    return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

export async function waitForParticlePaymasterApproval(
    quoteEndpoint,
    sessionToken,
    orderId,
    expiresAt,
    signal,
) {
    const deadline = Date.parse(expiresAt)
    if (!Number.isFinite(deadline) || deadline <= Date.now()) {
        throw sponsorshipError('INTENT_EXPIRED', 'The Particle sponsorship intent expired.', {
            stage: 'particle.paymaster-approval',
        })
    }
    while (Date.now() < deadline) {
        if (signal?.aborted) {
            throw sponsorshipError('SPONSORSHIP_REQUEST_ABORTED', 'The Gas Assist request was cancelled.', {
                stage: 'particle.paymaster-approval',
            })
        }
        const browserFailure = activeParticleBrowserFailure(orderId)
        if (browserFailure) {
            throw sponsorshipError(
                browserFailure.safeErrorCode,
                'Particle browser execution stopped before paymaster approval completed.',
                { stage: 'particle.paymaster-approval' },
            )
        }
        let order
        try {
            order = await fetchSponsorshipOrder(quoteEndpoint, sessionToken, orderId, signal)
        } catch (error) {
            if (error?.code === 'RATE_LIMITED' || error?.status === 429) {
                const backoffMs = Math.max(
                    PARTICLE_RATE_LIMIT_BACKOFF_MS,
                    Number(error?.retryAfterMs ?? 0),
                )
                gasAssistTrace('particle.paymaster-approval.rate-limited', {
                    orderId,
                    backoffMs,
                })
                await wait(backoffMs)
                continue
            }
            throw error
        }
        if (order?.atomicExecution?.paymasterApproval === 'approved' ||
            order?.atomicExecution?.stage === 'prepared') {
            return order
        }
        if (['expired', 'rejected', 'failed'].includes(order?.status)) {
            throw sponsorshipError(
                order?.safeErrorCode || 'PARTICLE_SPONSORSHIP_REJECTED',
                'Particle sponsorship was rejected by the Gas Assist policy.',
                { stage: 'particle.paymaster-approval' },
            )
        }
        await wait(PARTICLE_PAYMASTER_POLL_MS)
    }
    throw sponsorshipError(
        'PARTICLE_PAYMASTER_WEBHOOK_NOT_OBSERVED',
        'Particle did not obtain PistachioSwap paymaster approval for this exact operation. Nothing was submitted.',
        { stage: 'particle.paymaster-approval' },
    )
}

// Compatibility boundary for the existing hook. Despite the historical name,
// this function NEVER submits a signature or transaction to Pistachio's backend.
// It only waits for the RSA-authenticated Particle paymaster callback to approve
// the exact prepared intent. The fourth argument is intentionally ignored.
export function submitAtomicSponsorship(
    quoteEndpoint,
    sessionToken,
    orderId,
    _unusedSignedPayload,
    signal,
) {
    return fetchSponsorshipOrder(quoteEndpoint, sessionToken, orderId, signal)
        .then((order) => waitForParticlePaymasterApproval(
            quoteEndpoint,
            sessionToken,
            orderId,
            order?.expiresAt,
            signal,
        ))
}

export const prepaidSponsorshipInternals = {
    PARTICLE_BROWSER_STATE_TTL_MS,
    PARTICLE_PAYMASTER_POLL_MS,
    PARTICLE_RATE_LIMIT_BACKOFF_MS,
    SPONSORSHIP_ORDER_MIN_POLL_MS,
    SPONSORSHIP_ORDER_RATE_LIMIT_BACKOFF_MS,
    activeParticleBrowserFailure,
    clearDirectResults: () => {
        directResults.clear()
        directFailures.clear()
        orderPolls.clear()
    },
    clearOrderPolls: () => orderPolls.clear(),
    clearSessions: () => sessions.clear(),
    deleteExpiredSessions,
    requestJson,
    sponsorshipError,
    validDirectCall,
    validateParticlePrepared,
}
