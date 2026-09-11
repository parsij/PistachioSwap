import { keccak256 } from 'viem'

import { getGasAssistBaseUrl } from './gasAssist.js'
import {
    gasAssistTrace,
    gasAssistTraceError,
} from './gasAssistTrace.js'

const sessions = new Map()
const PUBLIC_MEGAFUEL_HOST = 'bsc-megafuel.nodereal.io'

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
            const gatewayTimeout = [502, 503, 504].includes(response.status)
            const error = sponsorshipError(
                gatewayTimeout
                    ? 'CROSS_CHAIN_GATEWAY_TIMEOUT'
                    : 'SPONSORSHIP_INVALID_RESPONSE',
                gatewayTimeout
                    ? 'Gas Assist took too long to confirm this route. Try again.'
                    : 'Gas Assist returned an unreadable response.',
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
        const gatewayTimeout = !payload?.error?.code &&
            [502, 503, 504].includes(response.status)
        const error = sponsorshipError(
            gatewayTimeout
                ? 'CROSS_CHAIN_GATEWAY_TIMEOUT'
                : payload?.error?.code ?? 'SPONSORSHIP_FAILED',
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

function normalizeDirectMegaFuelRpc(value) {
    let url
    try {
        url = new URL(String(value ?? ''))
    } catch {
        throw sponsorshipError(
            'DIRECT_SUBMISSION_INVALID',
            'Gas Assist returned an invalid direct MegaFuel endpoint.',
            { stage: 'atomic.authorize-direct' },
        )
    }
    if (
        url.protocol !== 'https:' ||
        url.hostname !== PUBLIC_MEGAFUEL_HOST ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
    ) {
        throw sponsorshipError(
            'DIRECT_SUBMISSION_INVALID',
            'Gas Assist returned an untrusted direct MegaFuel endpoint.',
            { stage: 'atomic.authorize-direct' },
        )
    }
    url.pathname = '/'
    return url.toString()
}

async function confirmDirectAtomicSubmission(
    quoteEndpoint,
    sessionToken,
    orderId,
    transactionHash,
    signal,
) {
    return post(
        quoteEndpoint,
        `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/atomic/confirm-direct`,
        { transactionHash },
        { sessionToken, signal, stage: 'atomic.confirm-direct' },
    )
}

async function sendRawTransactionDirectly(rpcUrl, signedRawTransaction, expectedHash, signal) {
    gasAssistTrace('atomic.direct-megafuel.start', {
        transactionHash: expectedHash,
        rpcHost: PUBLIC_MEGAFUEL_HOST,
    })
    let response
    try {
        response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_sendRawTransaction',
                params: [signedRawTransaction],
            }),
            redirect: 'error',
            signal,
        })
    } catch (cause) {
        throw sponsorshipError(
            cause?.name === 'AbortError'
                ? 'DIRECT_SUBMISSION_ABORTED'
                : 'DIRECT_SUBMISSION_NETWORK_ERROR',
            cause?.name === 'AbortError'
                ? 'The direct MegaFuel submission was cancelled.'
                : 'The wallet could not reach MegaFuel directly.',
            {
                stage: 'atomic.direct-megafuel',
                transactionHash: expectedHash,
                cause: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
            },
        )
    }

    const payload = await response.json().catch(() => null)
    const providerHash = typeof payload?.result === 'string'
        ? payload.result.toLowerCase()
        : null
    if (!response.ok || payload?.error || !/^0x[0-9a-f]{64}$/.test(providerHash ?? '')) {
        throw sponsorshipError(
            response.status === 429 ? 'PAYMASTER_RATE_LIMITED' : 'PAYMASTER_REJECTED',
            response.status === 429
                ? 'MegaFuel rate limited the direct wallet submission.'
                : 'MegaFuel rejected the direct wallet submission.',
            {
                stage: 'atomic.direct-megafuel',
                status: response.status,
                transactionHash: expectedHash,
                providerCode: payload?.error?.code,
            },
        )
    }
    if (providerHash !== expectedHash.toLowerCase()) {
        throw sponsorshipError(
            'PAYMASTER_HASH_MISMATCH',
            'MegaFuel returned a different transaction hash.',
            {
                stage: 'atomic.direct-megafuel',
                transactionHash: expectedHash,
            },
        )
    }
    gasAssistTrace('atomic.direct-megafuel.success', {
        transactionHash: providerHash,
    })
    return providerHash
}

/** Fetches abortable prepaid-sponsorship capability data from the backend derived from `quoteEndpoint`. */
export function fetchSponsorshipConfig(quoteEndpoint, signal) {
    return requestJson(
        `${getGasAssistBaseUrl(quoteEndpoint)}/v1/sponsorship/config`,
        { signal },
        'config.fetch',
    )
}

/** Authenticates the exact wallet address with a backend nonce and wallet signature. */
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

/** Requests the backend-prepared atomic sponsored transaction. */
export function prepareAtomicSponsorship(quoteEndpoint, sessionToken, orderId, signal) {
    return post(quoteEndpoint, `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/atomic/prepare`, {}, {
        sessionToken,
        signal,
        stage: 'atomic.prepare',
    })
}

/**
 * Registers only the deterministic transaction hash with Gas Assist before
 * broadcast, then sends the signed raw bytes from this browser directly to
 * MegaFuel. The backend never receives the raw transaction. Pre-registering the
 * hash lets the backend recover the on-chain transaction if the tab disappears
 * after MegaFuel accepts it but before the confirmation callback completes.
 */
export async function submitAtomicSponsorship(
    quoteEndpoint,
    sessionToken,
    orderId,
    signedRawTransaction,
    signal,
) {
    if (typeof signedRawTransaction !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(signedRawTransaction)) {
        throw sponsorshipError(
            'WALLET_RAW_TRANSACTION_MALFORMED',
            'The signed atomic transaction is invalid.',
            { stage: 'atomic.direct-megafuel' },
        )
    }
    const transactionHash = keccak256(signedRawTransaction).toLowerCase()
    const authorization = await post(
        quoteEndpoint,
        `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/atomic/authorize-direct`,
        { transactionHash },
        { sessionToken, signal, stage: 'atomic.authorize-direct' },
    )
    if (
        authorization?.mode !== 'wallet-direct-megafuel' ||
        authorization?.orderId !== orderId ||
        String(authorization?.transactionHash ?? '').toLowerCase() !== transactionHash ||
        !Number.isFinite(Date.parse(authorization?.expiresAt)) ||
        Date.parse(authorization.expiresAt) <= Date.now()
    ) {
        throw sponsorshipError(
            'DIRECT_SUBMISSION_INVALID',
            'Gas Assist returned an invalid direct-submission authorization.',
            { stage: 'atomic.authorize-direct' },
        )
    }
    const rpcUrl = normalizeDirectMegaFuelRpc(authorization.rpcUrl)

    try {
        const providerHash = await sendRawTransactionDirectly(
            rpcUrl,
            signedRawTransaction,
            transactionHash,
            signal,
        )
        return await confirmDirectAtomicSubmission(
            quoteEndpoint,
            sessionToken,
            orderId,
            providerHash,
            signal,
        )
    } catch (error) {
        try {
            const confirmed = await confirmDirectAtomicSubmission(
                quoteEndpoint,
                sessionToken,
                orderId,
                transactionHash,
                signal,
            )
            gasAssistTrace('atomic.direct-megafuel.reconciled', {
                orderId,
                transactionHash,
            })
            return confirmed
        } catch {
            gasAssistTraceError('atomic.direct-megafuel.error', error, {
                orderId,
                transactionHash,
            })
            throw error
        }
    }
}

/** Fetches the current server-authoritative state of one prepaid sponsorship order. */
export function fetchSponsorshipOrder(quoteEndpoint, sessionToken, orderId, signal) {
    return requestJson(
        `${getGasAssistBaseUrl(quoteEndpoint)}/v1/sponsorship/orders/${encodeURIComponent(orderId)}`,
        { headers: { authorization: `Bearer ${sessionToken}` }, signal },
        'order.poll',
    )
}

export const prepaidSponsorshipInternals = {
    clearSessions: () => sessions.clear(),
    deleteExpiredSessions,
    requestJson,
    sponsorshipError,
    normalizeDirectMegaFuelRpc,
    sendRawTransactionDirectly,
}
