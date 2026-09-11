import {
    normalizePreparedSponsoredTransaction,
    validateSignedPreparedTransaction,
} from './metamaskMultichain.js'
import { gasAssistTrace, gasAssistTraceError } from './gasAssistTrace.js'

const SUPPORTED_CONNECTOR_IDS = new Set(['pistachio-local'])
const PARTICLE_AUTH_SIGN_METHOD = 'pistachio_signParticleAuthorization'
const PARTICLE_CONTINUE_DELEGATION = Symbol.for('pistachioswap.particle.continue-delegation')
const SIGNATURE = /^0x[0-9a-f]{130}$/iu
const HASH = /^0x[0-9a-f]{64}$/iu

function signingError(code, message, details = {}) {
    const error = new Error(message)
    error.code = code
    error.details = details
    return error
}

function transactionSummary(transaction) {
    return {
        to: transaction?.to,
        nonce: transaction?.nonce,
        gas: transaction?.gas,
        chainId: transaction?.chainId,
        dataBytes: typeof transaction?.data === 'string'
            ? Math.max(0, (transaction.data.length - 2) / 2)
            : null,
    }
}

function assertParticlePackage(prepared, authenticatedWalletAddress) {
    if (
        !prepared ||
        prepared.provider !== 'particle' ||
        prepared.execution !== 'particle-paymaster-v06' ||
        Number(prepared.chainId) !== 56 ||
        !['delegation-required', 'sign'].includes(prepared.stage) ||
        prepared.paymentMode !== 'sponsored' ||
        !Number.isFinite(Date.parse(prepared.expiresAt)) ||
        Date.parse(prepared.expiresAt) <= Date.now() ||
        typeof prepared.orderId !== 'string' ||
        !prepared.orderId ||
        !Array.isArray(prepared.signatureRequests) ||
        prepared.signatureRequests.length !== 1 ||
        !/^0x[0-9a-f]{40}$/iu.test(String(authenticatedWalletAddress ?? ''))
    ) {
        throw signingError(
            'PARTICLE_USEROP_INVALID',
            'Gas Assist did not return a valid Particle signing package.',
            { stage: 'particle.validate' },
        )
    }

    const request = prepared.signatureRequests[0]
    if (prepared.stage === 'delegation-required') {
        if (String(request?.type ?? '') !== 'eip7702Auth') {
            throw signingError(
                'PARTICLE_SIGNATURE_REQUEST_INVALID',
                'Particle returned an invalid EIP-7702 authorization package.',
                { stage: 'particle.delegate' },
            )
        }
    } else if (String(request?.type ?? '') !== 'personal_sign' ||
        !HASH.test(String(request?.data?.raw ?? ''))) {
        throw signingError(
            'PARTICLE_SIGNATURE_REQUEST_INVALID',
            'Particle returned an invalid UserOperation signing package.',
            { stage: 'particle.sign' },
        )
    }
    return prepared
}

async function signParticleSignatureRequest({ walletClient, request, authenticatedWalletAddress }) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw signingError('PARTICLE_SIGNATURE_REQUEST_INVALID', 'Particle returned an invalid signature request.')
    }
    const type = String(request.type ?? '')

    if (type === 'personal_sign') {
        const raw = String(request.data?.raw ?? '')
        if (!HASH.test(raw) || typeof walletClient?.signMessage !== 'function') {
            throw signingError('PARTICLE_SIGNATURE_REQUEST_INVALID', 'Particle returned an invalid UserOperation hash.')
        }
        const signature = await walletClient.signMessage({
            account: authenticatedWalletAddress,
            message: { raw },
        })
        if (!SIGNATURE.test(String(signature ?? ''))) {
            throw signingError('INVALID_SIGNATURE', 'Pistachio Wallet returned an invalid UserOperation signature.')
        }
        return signature
    }

    if (type === 'eip7702Auth') {
        if (typeof walletClient?.request !== 'function') {
            throw signingError('PISTACHIO_WALLET_REQUIRED', 'Pistachio Wallet cannot sign the Particle authorization.')
        }
        const signature = await walletClient.request({
            method: PARTICLE_AUTH_SIGN_METHOD,
            params: [request],
        })
        if (!SIGNATURE.test(String(signature ?? ''))) {
            throw signingError('INVALID_SIGNATURE', 'Pistachio Wallet returned an invalid EIP-7702 authorization signature.')
        }
        return signature
    }

    throw signingError(
        'PARTICLE_SIGNATURE_TYPE_UNSUPPORTED',
        'Particle requested an unsupported signature type.',
        { signatureType: type },
    )
}

export function detectRawTransactionSigning({ connector, walletClient }) {
    const connectorId = String(connector?.id ?? '').trim().toLowerCase()
    const supported = SUPPORTED_CONNECTOR_IDS.has(connectorId) && typeof walletClient?.request === 'function'
    const transport = supported ? 'pistachio-local' : null
    return Object.freeze({
        rawTransactionSigningSupported: supported,
        method: supported ? 'eth_signTransaction' : null,
        atomicMethod: supported ? PARTICLE_AUTH_SIGN_METHOD : null,
        transport,
        status: supported ? 'verified' : 'unsupported',
        scope: supported ? 'eip155:56' : null,
        account: null,
        approvedMethods: supported
            ? ['personal_sign', PARTICLE_AUTH_SIGN_METHOD]
            : [],
        reasonCode: supported ? null : 'PISTACHIO_WALLET_REQUIRED',
    })
}

export async function signRawSponsoredTransaction({ capability, walletClient, transaction, action = 'sponsored-transaction' }) {
    if (capability?.rawTransactionSigningSupported !== true ||
        capability.transport !== 'pistachio-local' || typeof walletClient?.request !== 'function') {
        throw signingError('PISTACHIO_WALLET_REQUIRED', 'Gas Assist requires Pistachio Wallet.', {
            stage: 'wallet.sign', action,
        })
    }
    const signedRawTransaction = await walletClient.request({
        method: 'eth_signTransaction',
        params: [transaction],
    })
    if (typeof signedRawTransaction !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(signedRawTransaction)) {
        throw signingError('WALLET_RAW_TRANSACTION_MALFORMED', 'Pistachio Wallet returned an invalid signed transaction.')
    }
    return signedRawTransaction
}

export async function signPreparedSponsoredTransaction({
    transport,
    capability,
    walletClient,
    preparedTransaction,
    authenticatedWalletAddress,
    multichainAccount,
    submitSignedTransaction,
    action = 'sponsored-transaction',
}) {
    if (typeof submitSignedTransaction !== 'function') {
        throw signingError('SPONSORSHIP_SUBMISSION_REQUIRED', 'A sponsorship submission callback is required.')
    }
    if (transport !== 'pistachio-local') {
        throw signingError('PISTACHIO_WALLET_REQUIRED', 'Gas Assist requires Pistachio Wallet.')
    }
    const normalizedTransaction = normalizePreparedSponsoredTransaction(preparedTransaction, authenticatedWalletAddress)
    let signedRawTransaction = null
    try {
        signedRawTransaction = await signRawSponsoredTransaction({
            capability, walletClient, transaction: normalizedTransaction, action,
        })
        await validateSignedPreparedTransaction({
            signedRawTransaction,
            normalizedTransaction,
            authenticatedWalletAddress,
            multichainAccount: multichainAccount ?? authenticatedWalletAddress,
        })
        return await submitSignedTransaction(signedRawTransaction)
    } finally {
        signedRawTransaction = null
    }
}

export async function signPreparedAtomicSponsoredTransaction({
    transport,
    capability,
    walletClient,
    prepared,
    authenticatedWalletAddress,
    submitSignedTransaction,
}) {
    if (
        transport !== 'pistachio-local' ||
        capability?.atomicMethod !== PARTICLE_AUTH_SIGN_METHOD ||
        typeof walletClient?.request !== 'function' ||
        typeof submitSignedTransaction !== 'function'
    ) {
        throw signingError(
            'PISTACHIO_WALLET_REQUIRED',
            'Particle Gas Assist requires Pistachio Wallet.',
            { stage: 'particle.validate' },
        )
    }

    let current = assertParticlePackage(prepared, authenticatedWalletAddress)
    gasAssistTrace('signing.particle.start', { orderId: current.orderId, stage: current.stage })
    try {
        if (current.stage === 'delegation-required') {
            const continueDelegation = current[PARTICLE_CONTINUE_DELEGATION]
            if (typeof continueDelegation !== 'function') {
                throw signingError(
                    'PARTICLE_DELEGATION_CONTINUATION_MISSING',
                    'The Particle delegation can no longer be continued.',
                    { stage: 'particle.delegate' },
                )
            }
            const authorizationSignature = await signParticleSignatureRequest({
                walletClient,
                request: current.signatureRequests[0],
                authenticatedWalletAddress,
            })
            current = assertParticlePackage(
                await continueDelegation(authorizationSignature),
                authenticatedWalletAddress,
            )
            if (current.stage !== 'sign') {
                throw signingError(
                    'PARTICLE_USEROP_INVALID',
                    'Particle did not return the UserOperation after delegation.',
                    { stage: 'particle.delegate' },
                )
            }
        }

        const signature = await signParticleSignatureRequest({
            walletClient,
            request: current.signatureRequests[0],
            authenticatedWalletAddress,
        })
        const result = await submitSignedTransaction([signature])
        gasAssistTrace('signing.particle.success', {
            orderId: current.orderId,
            signatureCount: 1,
        })
        return result
    } catch (error) {
        gasAssistTraceError('signing.particle.error', error, { orderId: current?.orderId })
        throw error
    }
}

export const rawSigningInternals = {
    PARTICLE_AUTH_SIGN_METHOD,
    PARTICLE_CONTINUE_DELEGATION,
    assertParticlePackage,
    signParticleSignatureRequest,
    supportedConnectorIds: SUPPORTED_CONNECTOR_IDS,
    transactionSummary,
}
