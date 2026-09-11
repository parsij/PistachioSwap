import {
    normalizePreparedSponsoredTransaction,
    validateSignedPreparedTransaction,
} from './metamaskMultichain.js'
import { gasAssistTrace, gasAssistTraceError } from './gasAssistTrace.js'

const SUPPORTED_CONNECTOR_IDS = new Set(['pistachio-local'])
const PARTICLE_AUTH_SIGN_METHOD = 'pistachio_signParticleAuthorization'
const SIGNATURE = /^0x[0-9a-f]{130}$/iu

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
        prepared.execution !== 'particle-paymaster' ||
        Number(prepared.chainId) !== 56 ||
        prepared.stage !== 'sign' ||
        prepared.paymentMode !== 'sponsored' ||
        !Number.isFinite(Date.parse(prepared.expiresAt)) ||
        Date.parse(prepared.expiresAt) <= Date.now() ||
        typeof prepared.orderId !== 'string' ||
        !prepared.orderId ||
        !Array.isArray(prepared.signatureRequests) ||
        prepared.signatureRequests.length < 1 ||
        prepared.signatureRequests.length > 2 ||
        !/^0x[0-9a-f]{40}$/iu.test(String(authenticatedWalletAddress ?? ''))
    ) {
        throw signingError(
            'PARTICLE_USEROP_INVALID',
            'Gas Assist did not return a valid Particle signing package.',
            { stage: 'particle.validate' },
        )
    }
    const types = prepared.signatureRequests.map((request) => String(request?.type ?? ''))
    if (types.filter((type) => type === 'eth_signTypedData_v4').length !== 1 ||
        types.filter((type) => type === 'eip7702Auth').length > 1 ||
        types.some((type) => type !== 'eth_signTypedData_v4' && type !== 'eip7702Auth')) {
        throw signingError(
            'PARTICLE_SIGNATURE_REQUEST_INVALID',
            'Particle returned an unsupported Gas Assist signing package.',
            { stage: 'particle.validate' },
        )
    }
    return prepared
}

async function signParticleSignatureRequest({ walletClient, request, authenticatedWalletAddress }) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw signingError('PARTICLE_SIGNATURE_REQUEST_INVALID', 'Particle returned an invalid signature request.')
    }
    const type = String(request.type ?? '')
    if (type === 'eth_signTypedData_v4') {
        if (typeof walletClient?.signTypedData !== 'function' ||
            !request.data || typeof request.data !== 'object' || Array.isArray(request.data)) {
            throw signingError('PARTICLE_SIGNATURE_REQUEST_INVALID', 'Particle returned invalid UserOperation typed data.')
        }
        const signature = await walletClient.signTypedData({
            account: authenticatedWalletAddress,
            ...request.data,
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
            ? ['eth_signTypedData_v4', PARTICLE_AUTH_SIGN_METHOD]
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

    const current = assertParticlePackage(prepared, authenticatedWalletAddress)
    gasAssistTrace('signing.particle.start', { orderId: current.orderId })
    try {
        const signatures = []
        for (const request of current.signatureRequests) {
            signatures.push(await signParticleSignatureRequest({
                walletClient,
                request,
                authenticatedWalletAddress,
            }))
        }
        const result = await submitSignedTransaction(signatures)
        gasAssistTrace('signing.particle.success', {
            orderId: current.orderId,
            signatureCount: signatures.length,
        })
        return result
    } catch (error) {
        gasAssistTraceError('signing.particle.error', error, { orderId: current.orderId })
        throw error
    }
}

export const rawSigningInternals = {
    PARTICLE_AUTH_SIGN_METHOD,
    assertParticlePackage,
    signParticleSignatureRequest,
    supportedConnectorIds: SUPPORTED_CONNECTOR_IDS,
    transactionSummary,
}
