import { getGasAssistBaseUrl } from './gasAssist.js'
import { gasAssistTrace, gasAssistTraceError } from './gasAssistTrace.js'

const sessions = new Map()
const SIGNATURE = /^0x[0-9a-f]{130}$/iu
const HASH = /^0x[0-9a-f]{64}$/iu
const PARTICLE_CONTINUE_DELEGATION = Symbol.for('pistachioswap.particle.continue-delegation')

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

function validateParticlePrepared(prepared, orderId) {
    if (
        !prepared ||
        prepared.provider !== 'particle' ||
        prepared.execution !== 'particle-paymaster-v06' ||
        Number(prepared.chainId) !== 56 ||
        prepared.orderId !== orderId ||
        !['delegation-required', 'sign'].includes(prepared.stage) ||
        prepared.paymentMode !== 'sponsored' ||
        !Number.isFinite(Date.parse(prepared.expiresAt)) ||
        Date.parse(prepared.expiresAt) <= Date.now() ||
        !Array.isArray(prepared.signatureRequests) ||
        prepared.signatureRequests.length !== 1
    ) {
        throw sponsorshipError(
            'PARTICLE_USEROP_INVALID',
            'Gas Assist returned an invalid Particle signing package.',
            { stage: 'atomic.prepare' },
        )
    }

    const request = prepared.signatureRequests[0]
    const type = String(request?.type ?? '')
    if (prepared.stage === 'delegation-required') {
        if (type !== 'eip7702Auth' || prepared.signing?.method !== 'pistachio_signParticleAuthorization') {
            throw sponsorshipError(
                'PARTICLE_SIGNATURE_REQUEST_INVALID',
                'Particle returned an invalid EIP-7702 delegation request.',
                { stage: 'atomic.delegate' },
            )
        }
    } else if (type !== 'personal_sign' || !HASH.test(String(request?.data?.raw ?? ''))) {
        throw sponsorshipError(
            'PARTICLE_SIGNATURE_REQUEST_INVALID',
            'Particle returned an invalid UserOperation signature request.',
            { stage: 'atomic.sign' },
        )
    }
    return prepared
}

function attachDelegationContinuation(prepared, context) {
    if (prepared.stage !== 'delegation-required') return prepared
    Object.defineProperty(prepared, PARTICLE_CONTINUE_DELEGATION, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: async (signature) => {
            if (!SIGNATURE.test(String(signature ?? ''))) {
                throw sponsorshipError(
                    'INVALID_SIGNATURE',
                    'The Particle EIP-7702 authorization signature is invalid.',
                    { stage: 'atomic.delegate' },
                )
            }
            const next = await post(
                context.quoteEndpoint,
                `/v1/sponsorship/orders/${encodeURIComponent(context.orderId)}/atomic/delegate`,
                { signature },
                {
                    sessionToken: context.sessionToken,
                    signal: context.signal,
                    stage: 'atomic.delegate',
                },
            )
            return validateParticlePrepared(next, context.orderId)
        },
    })
    return prepared
}

export async function fetchSponsorshipConfig(quoteEndpoint, signal) {
    const payload = await requestJson(
        `${getGasAssistBaseUrl(quoteEndpoint)}/v1/sponsorship/config`,
        { signal },
        'config.fetch',
    )
    return payload?.enabled === true
        ? { ...payload, provider: payload.provider ?? 'particle', atomicExecution: true }
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
    const prepared = validateParticlePrepared(await post(
        quoteEndpoint,
        `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/atomic/prepare`,
        {},
        { sessionToken, signal, stage: 'atomic.prepare' },
    ), orderId)
    return attachDelegationContinuation(prepared, {
        quoteEndpoint,
        sessionToken,
        orderId,
        signal,
    })
}

export async function submitAtomicSponsorship(
    quoteEndpoint,
    sessionToken,
    orderId,
    signatures,
    signal,
) {
    if (!Array.isArray(signatures) || signatures.length !== 1 || !SIGNATURE.test(String(signatures[0] ?? ''))) {
        throw sponsorshipError(
            'INVALID_SIGNATURE',
            'The Particle Gas Assist UserOperation signature is invalid.',
            { stage: 'atomic.submit' },
        )
    }
    const result = await post(
        quoteEndpoint,
        `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/atomic/submit`,
        { signatures },
        { sessionToken, signal, stage: 'atomic.submit' },
    )
    if (result?.orderId !== orderId || typeof result?.userOperationHash !== 'string' ||
        !HASH.test(result.userOperationHash)) {
        throw sponsorshipError(
            'PARTICLE_SUBMISSION_INVALID',
            'Particle returned an invalid Gas Assist UserOperation identifier.',
            { stage: 'atomic.submit' },
        )
    }
    return result
}

export function fetchSponsorshipOrder(quoteEndpoint, sessionToken, orderId, signal) {
    return requestJson(
        `${getGasAssistBaseUrl(quoteEndpoint)}/v1/sponsorship/orders/${encodeURIComponent(orderId)}`,
        { headers: { authorization: `Bearer ${sessionToken}` }, signal },
        'order.poll',
    )
}

export const prepaidSponsorshipInternals = {
    PARTICLE_CONTINUE_DELEGATION,
    attachDelegationContinuation,
    clearSessions: () => sessions.clear(),
    deleteExpiredSessions,
    requestJson,
    sponsorshipError,
    validateParticlePrepared,
}
