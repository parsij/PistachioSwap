import { getGasAssistBaseUrl } from './gasAssist.js'
import {
    gasAssistTrace,
    gasAssistTraceError,
} from './gasAssistTrace.js'

const sessions = new Map()

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
    return error
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
            {
                stage,
                method,
                path,
                elapsedMs: Date.now() - startedAt,
                cause: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
            },
        )
        gasAssistTraceError('http.request.error', error, { stage, method, path })
        throw error
    }

    const requestId = response.headers.get('x-request-id') ??
        response.headers.get('x-correlation-id') ??
        undefined
    const text = await response.text()
    let payload = null
    if (text) {
        try {
            payload = JSON.parse(text)
        } catch (cause) {
            const error = sponsorshipError(
                'SPONSORSHIP_INVALID_RESPONSE',
                'Gas Assist returned an unreadable response.',
                {
                    stage,
                    method,
                    path,
                    status: response.status,
                    requestId,
                    elapsedMs: Date.now() - startedAt,
                    responsePreview: text.slice(0, 200),
                    cause: cause instanceof Error ? cause.message : String(cause),
                },
            )
            gasAssistTraceError('http.request.error', error, { stage, method, path })
            throw error
        }
    }

    if (!response.ok) {
        const error = sponsorshipError(
            payload?.error?.code ?? 'SPONSORSHIP_FAILED',
            payload?.error?.message ?? `Gas Assist request failed with HTTP ${response.status}.`,
            {
                stage,
                method,
                path,
                status: response.status,
                requestId,
                backendDetails: payload?.error?.details,
                elapsedMs: Date.now() - startedAt,
            },
        )
        gasAssistTraceError('http.request.error', error, { stage, method, path })
        throw error
    }

    if (payload === null) {
        const error = sponsorshipError(
            'SPONSORSHIP_EMPTY_RESPONSE',
            'Gas Assist returned an empty response.',
            {
                stage,
                method,
                path,
                status: response.status,
                requestId,
                elapsedMs: Date.now() - startedAt,
            },
        )
        gasAssistTraceError('http.request.error', error, { stage, method, path })
        throw error
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

/** Fetches abortable prepaid-sponsorship capability data from the backend derived from `quoteEndpoint`. */
export function fetchSponsorshipConfig(quoteEndpoint, signal) {
    return requestJson(
        `${getGasAssistBaseUrl(quoteEndpoint)}/v1/sponsorship/config`,
        { signal },
        'config.fetch',
    )
}

/**
 * Authenticates the exact wallet address with a backend nonce and wallet signature.
 * @returns {Promise<object>} Backend session token and authentication metadata.
 * @throws For malformed challenges, wallet rejection, or backend authentication failure.
 * @sideEffects Performs backend HTTP and invokes the supplied signing callback once.
 */
export async function authenticateSponsorshipWallet({
    quoteEndpoint,
    walletAddress,
    walletClient,
    signal,
}) {
    deleteExpiredSessions()
    const key = `${getGasAssistBaseUrl(quoteEndpoint)}:${walletAddress.toLowerCase()}`
    const existing = sessions.get(key)
    if (existing && Date.parse(existing.expiresAt) > Date.now() + 5_000) {
        gasAssistTrace('auth.session.cache-hit', {
            walletAddress,
            expiresAt: existing.expiresAt,
        })
        return existing
    }
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

    gasAssistTrace('auth.wallet-signature.start', { walletAddress })
    let signature
    try {
        signature = await walletClient.signMessage({
            account: walletAddress,
            message: challenge.message,
        })
        gasAssistTrace('auth.wallet-signature.success', { walletAddress })
    } catch (error) {
        gasAssistTraceError('auth.wallet-signature.error', error, { walletAddress })
        throw error
    }

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

/** Creates one idempotent prepaid sponsorship order through the authenticated backend session. */
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
        sessionToken,
        idempotencyKey,
        signal,
        stage: 'order.create',
    })
}

/** Requests the backend-prepared payment transaction for an existing sponsorship order. */
export function prepareSponsorshipPayment(quoteEndpoint, sessionToken, orderId, signal) {
    return post(quoteEndpoint, `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/payment/prepare`, {}, {
        sessionToken,
        signal,
        stage: 'payment.prepare',
    })
}

/** Requests the backend-prepared token approval for an existing sponsorship order. */
export function prepareSponsorshipApproval(quoteEndpoint, sessionToken, orderId, signal) {
    return post(quoteEndpoint, `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/approval/prepare`, { reusableApproval: false }, {
        sessionToken,
        signal,
        stage: 'approval.prepare',
    })
}

/** Submits signed transaction bytes for a specific authenticated sponsorship intent. */
export function submitSponsorshipIntent(quoteEndpoint, sessionToken, intentId, signedRawTransaction, signal) {
    return post(quoteEndpoint, `/v1/sponsorship/intents/${encodeURIComponent(intentId)}/submit`, { signedRawTransaction }, {
        sessionToken,
        signal,
        stage: 'intent.submit',
    })
}

/** Requests all three exact transactions before any transaction is broadcast. */
export function prepareSponsorshipPackage(quoteEndpoint, sessionToken, orderId, signal) {
    return post(quoteEndpoint, `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/package/prepare`, {}, {
        sessionToken,
        signal,
        stage: 'package.prepare',
    })
}

/** Atomically stores all three signed raw transactions before backend execution. */
export function submitSponsorshipPackage(quoteEndpoint, sessionToken, orderId, signedTransactions, signal) {
    if (!Array.isArray(signedTransactions) || signedTransactions.length !== 3) {
        throw sponsorshipError(
            'SPONSORSHIP_PACKAGE_INVALID',
            'Payment, approval, and swap signatures are all required.',
            { stage: 'package.submit' },
        )
    }
    return post(quoteEndpoint, `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/package/submit`, { signedTransactions }, {
        sessionToken,
        signal,
        stage: 'package.submit',
    })
}

/** Fetches the current server-authoritative state of one prepaid sponsorship order. */
export function fetchSponsorshipOrder(quoteEndpoint, sessionToken, orderId, signal) {
    return requestJson(
        `${getGasAssistBaseUrl(quoteEndpoint)}/v1/sponsorship/orders/${encodeURIComponent(orderId)}`,
        { headers: { authorization: `Bearer ${sessionToken}` }, signal },
        'order.poll',
    )
}

/** Requests the next exact backend-prepared sponsored transaction. */
export function prepareSponsorshipContinuation(quoteEndpoint, sessionToken, orderId, signal) {
    return post(quoteEndpoint, `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/continuation`, {}, {
        sessionToken,
        signal,
        stage: 'continuation.prepare',
    })
}

export const prepaidSponsorshipInternals = {
    clearSessions: () => sessions.clear(),
    deleteExpiredSessions,
    requestJson,
    sponsorshipError,
}
