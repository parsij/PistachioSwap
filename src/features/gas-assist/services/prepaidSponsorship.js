import { getGasAssistBaseUrl } from './gasAssist.js'

const sessions = new Map()

async function requestJson(url, options = {}) {
    const response = await fetch(url, options)
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
        const error = new Error(payload?.error?.message ?? 'Prepaid Gas Assist is unavailable.')
        error.code = payload?.error?.code ?? 'SPONSORSHIP_FAILED'
        error.details = payload?.error?.details
        throw error
    }
    return payload
}

function post(quoteEndpoint, path, body, { sessionToken, idempotencyKey, signal } = {}) {
    return requestJson(`${getGasAssistBaseUrl(quoteEndpoint)}${path}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
            ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
        body: JSON.stringify(body ?? {}),
        signal,
    })
}

/** Fetches abortable prepaid-sponsorship capability data from the backend derived from `quoteEndpoint`. */
export function fetchSponsorshipConfig(quoteEndpoint, signal) {
    return requestJson(`${getGasAssistBaseUrl(quoteEndpoint)}/v1/sponsorship/config`, { signal })
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
    const key = `${quoteEndpoint}:${walletAddress.toLowerCase()}`
    const existing = sessions.get(key)
    if (existing && Date.parse(existing.expiresAt) > Date.now() + 5_000) return existing
    const challenge = await post(quoteEndpoint, '/v1/sponsorship/auth/challenge', {
        walletAddress,
        chainId: 56,
    }, { signal })
    const signature = await walletClient.signMessage({
        account: walletAddress,
        message: challenge.message,
    })
    const session = await post(quoteEndpoint, '/v1/sponsorship/auth/verify', {
        challengeId: challenge.challengeId,
        signature,
    }, { signal })
    sessions.set(key, session)
    return session
}

/** Creates one idempotent prepaid sponsorship order through the authenticated backend session. */
export function createSponsorshipOrder(quoteEndpoint, sessionToken, request, idempotencyKey, signal) {
    const allowed = new Set(['sellToken', 'buyToken', 'grossInputAmount', 'slippageBps'])
    if (!request || Object.keys(request).some((key) => !allowed.has(key)) ||
        [...allowed].some((key) => !(key in request))) {
        throw new Error('Sponsorship order requests contain unsupported fields.')
    }
    return post(quoteEndpoint, '/v1/sponsorship/orders', request, {
        sessionToken,
        idempotencyKey,
        signal,
    })
}

/** Requests the backend-prepared payment transaction for an existing sponsorship order. */
export function prepareSponsorshipPayment(quoteEndpoint, sessionToken, orderId, signal) {
    return post(quoteEndpoint, `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/payment/prepare`, {}, { sessionToken, signal })
}

/** Requests the backend-prepared token approval for an existing sponsorship order. */
export function prepareSponsorshipApproval(quoteEndpoint, sessionToken, orderId, signal) {
    return post(quoteEndpoint, `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/approval/prepare`, { reusableApproval: false }, { sessionToken, signal })
}

/** Submits signed transaction bytes for a specific authenticated sponsorship intent. */
export function submitSponsorshipIntent(quoteEndpoint, sessionToken, intentId, signedRawTransaction, signal) {
    return post(quoteEndpoint, `/v1/sponsorship/intents/${encodeURIComponent(intentId)}/submit`, { signedRawTransaction }, { sessionToken, signal })
}

/** Requests all three exact transactions before any transaction is broadcast. */
export function prepareSponsorshipPackage(quoteEndpoint, sessionToken, orderId, signal) {
    return post(quoteEndpoint, `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/package/prepare`, {}, { sessionToken, signal })
}

/** Atomically stores all three signed raw transactions before backend execution. */
export function submitSponsorshipPackage(quoteEndpoint, sessionToken, orderId, signedTransactions, signal) {
    return post(quoteEndpoint, `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/package/submit`, { signedTransactions }, { sessionToken, signal })
}

/** Fetches the current server-authoritative state of one prepaid sponsorship order. */
export function fetchSponsorshipOrder(quoteEndpoint, sessionToken, orderId, signal) {
    return requestJson(
        `${getGasAssistBaseUrl(quoteEndpoint)}/v1/sponsorship/orders/${encodeURIComponent(orderId)}`,
        { headers: { authorization: `Bearer ${sessionToken}` }, signal },
    )
}

/** Requests the next exact backend-prepared sponsored transaction. */
export function prepareSponsorshipContinuation(quoteEndpoint, sessionToken, orderId, signal) {
    return post(quoteEndpoint, `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/continuation`, {}, { sessionToken, signal })
}

export const prepaidSponsorshipInternals = {
    clearSessions: () => sessions.clear(),
}
