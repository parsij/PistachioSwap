import {
    normalizePreparedSponsoredTransaction,
    validateSignedPreparedTransaction,
} from './metamaskMultichain.js'
import {
    gasAssistTrace,
    gasAssistTraceError,
} from './gasAssistTrace.js'

const SUPPORTED_CONNECTOR_IDS = new Set([
    'pistachio-local',
])
const ALCHEMY_AUTH_SIGN_METHOD = 'pistachio_signAlchemyAuthorization'
const ALCHEMY_CONTINUE_PERMIT = Symbol.for('pistachioswap.alchemy.continue-permit')
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

function assertAlchemyPackage(prepared, authenticatedWalletAddress) {
    if (
        !prepared ||
        prepared.provider !== 'alchemy' ||
        prepared.execution !== 'alchemy-wallet-api' ||
        Number(prepared.chainId) !== 56 ||
        !['permit-required', 'sign'].includes(prepared.stage) ||
        !['erc20-preop', 'sponsored'].includes(prepared.paymentMode) ||
        !Number.isFinite(Date.parse(prepared.expiresAt)) ||
        Date.parse(prepared.expiresAt) <= Date.now() ||
        typeof prepared.orderId !== 'string' ||
        !prepared.orderId ||
        !Array.isArray(prepared.signatureRequests) ||
        prepared.signatureRequests.length < 1 ||
        prepared.signatureRequests.length > 3 ||
        !/^0x[0-9a-f]{40}$/iu.test(String(authenticatedWalletAddress ?? ''))
    ) {
        throw signingError(
            'ALCHEMY_PREPARED_CALL_INVALID',
            'Gas Assist did not return a valid Alchemy signing package.',
            { stage: 'alchemy.validate' },
        )
    }
    return prepared
}

async function signAlchemySignatureRequest({
    walletClient,
    request,
    authenticatedWalletAddress,
}) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw signingError('ALCHEMY_SIGNATURE_REQUEST_INVALID', 'Alchemy returned an invalid signature request.')
    }
    const type = String(request.type ?? '')
    if (type === 'personal_sign') {
        if (typeof walletClient?.signMessage !== 'function') {
            throw signingError('WALLET_MESSAGE_SIGNING_UNAVAILABLE', 'Pistachio Wallet cannot sign the Alchemy operation.')
        }
        const data = request.data
        const message = data && typeof data === 'object' && !Array.isArray(data) && typeof data.raw === 'string'
            ? { raw: data.raw }
            : typeof data === 'string'
                ? data
                : null
        if (!message) {
            throw signingError('ALCHEMY_SIGNATURE_REQUEST_INVALID', 'Alchemy returned an invalid personal-sign request.')
        }
        const signature = await walletClient.signMessage({
            account: authenticatedWalletAddress,
            message,
        })
        if (!SIGNATURE.test(String(signature ?? ''))) {
            throw signingError('INVALID_SIGNATURE', 'Pistachio Wallet returned an invalid Alchemy owner signature.')
        }
        return signature
    }

    if (type === 'eth_signTypedData_v4') {
        if (typeof walletClient?.signTypedData !== 'function' ||
            !request.data || typeof request.data !== 'object' || Array.isArray(request.data)) {
            throw signingError('ALCHEMY_SIGNATURE_REQUEST_INVALID', 'Alchemy returned an invalid typed-data request.')
        }
        const signature = await walletClient.signTypedData({
            account: authenticatedWalletAddress,
            ...request.data,
        })
        if (!SIGNATURE.test(String(signature ?? ''))) {
            throw signingError('INVALID_SIGNATURE', 'Pistachio Wallet returned an invalid Alchemy typed-data signature.')
        }
        return signature
    }

    if (type === 'eip7702Auth') {
        if (typeof walletClient?.request !== 'function') {
            throw signingError('PISTACHIO_WALLET_REQUIRED', 'Pistachio Wallet cannot sign the Alchemy authorization.')
        }
        const signature = await walletClient.request({
            method: ALCHEMY_AUTH_SIGN_METHOD,
            params: [request],
        })
        if (!SIGNATURE.test(String(signature ?? ''))) {
            throw signingError('INVALID_SIGNATURE', 'Pistachio Wallet returned an invalid EIP-7702 authorization signature.')
        }
        return signature
    }

    throw signingError(
        'ALCHEMY_SIGNATURE_TYPE_UNSUPPORTED',
        'Alchemy requested an unsupported signature type.',
        { signatureType: type },
    )
}

/** Derives Gas Assist signing capability without prompting the connected wallet. */
export function detectRawTransactionSigning({ connector, walletClient }) {
    const connectorId = String(connector?.id ?? '').trim().toLowerCase()
    const supported = SUPPORTED_CONNECTOR_IDS.has(connectorId) && typeof walletClient?.request === 'function'
    const transport = supported ? 'pistachio-local' : null
    const result = Object.freeze({
        rawTransactionSigningSupported: supported,
        method: supported ? 'eth_signTransaction' : null,
        atomicMethod: supported ? ALCHEMY_AUTH_SIGN_METHOD : null,
        transport,
        status: supported ? 'verified' : 'unsupported',
        scope: supported ? 'eip155:56' : null,
        account: null,
        approvedMethods: supported
            ? ['personal_sign', 'eth_signTypedData_v4', ALCHEMY_AUTH_SIGN_METHOD]
            : [],
        reasonCode: supported ? null : 'PISTACHIO_WALLET_REQUIRED',
    })
    gasAssistTrace('signing.capability.detected', {
        connectorId,
        supported,
        transport,
    })
    return result
}

/**
 * Signs an exact raw transaction. Retained for provider-neutral wallet flows;
 * Alchemy Gas Assist uses signature requests instead of raw sponsored transactions.
 */
export async function signRawSponsoredTransaction({
    capability,
    walletClient,
    transaction,
    action = 'sponsored-transaction',
}) {
    if (
        capability?.rawTransactionSigningSupported !== true ||
        capability.transport !== 'pistachio-local' ||
        typeof walletClient?.request !== 'function'
    ) {
        throw signingError(
            'PISTACHIO_WALLET_REQUIRED',
            'Gas Assist requires Pistachio Wallet.',
            { stage: 'wallet.sign', action },
        )
    }

    gasAssistTrace('signing.wallet-request.start', {
        action,
        transaction: transactionSummary(transaction),
    })
    const signedRawTransaction = await walletClient.request({
        method: 'eth_signTransaction',
        params: [transaction],
    }).catch((error) => {
        gasAssistTraceError('signing.wallet-request.error', error, {
            action,
            transaction: transactionSummary(transaction),
        })
        throw error
    })
    if (typeof signedRawTransaction !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(signedRawTransaction)) {
        throw signingError(
            'WALLET_RAW_TRANSACTION_MALFORMED',
            'Pistachio Wallet returned an invalid signed transaction.',
            { stage: 'wallet.sign', action },
        )
    }
    return signedRawTransaction
}

/** Signs and validates a provider-neutral raw prepared transaction. */
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
        throw signingError(
            'SPONSORSHIP_SUBMISSION_REQUIRED',
            'A sponsorship submission callback is required.',
            { stage: 'intent.submit', action },
        )
    }
    if (transport !== 'pistachio-local') {
        throw signingError(
            'PISTACHIO_WALLET_REQUIRED',
            'Gas Assist requires Pistachio Wallet.',
            { stage: 'wallet.sign', action },
        )
    }

    const normalizedTransaction = normalizePreparedSponsoredTransaction(
        preparedTransaction,
        authenticatedWalletAddress,
    )
    let signedRawTransaction = null
    try {
        signedRawTransaction = await signRawSponsoredTransaction({
            capability,
            walletClient,
            transaction: normalizedTransaction,
            action,
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

/**
 * Signs an Alchemy Wallet API Gas Assist package. If pre-op token payment needs
 * a permit, the permit is signed first and the backend obtains the final package
 * before any operation signatures are requested.
 */
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
        capability?.atomicMethod !== ALCHEMY_AUTH_SIGN_METHOD ||
        typeof walletClient?.request !== 'function' ||
        typeof submitSignedTransaction !== 'function'
    ) {
        throw signingError(
            'PISTACHIO_WALLET_REQUIRED',
            'Alchemy Gas Assist requires Pistachio Wallet.',
            { stage: 'alchemy.validate' },
        )
    }

    let current = assertAlchemyPackage(prepared, authenticatedWalletAddress)
    gasAssistTrace('signing.alchemy.start', {
        orderId: current.orderId,
        paymentMode: current.paymentMode,
        stage: current.stage,
    })

    try {
        if (current.stage === 'permit-required') {
            if (current.signatureRequests.length !== 1) {
                throw signingError(
                    'ALCHEMY_PREPARED_CALL_INVALID',
                    'Alchemy returned an unexpected gas-token permit package.',
                    { stage: 'alchemy.permit' },
                )
            }
            const continuePermit = current[ALCHEMY_CONTINUE_PERMIT]
            if (typeof continuePermit !== 'function') {
                throw signingError(
                    'ALCHEMY_PERMIT_CONTINUATION_MISSING',
                    'The Alchemy gas-token permit can no longer be continued.',
                    { stage: 'alchemy.permit' },
                )
            }
            const permitSignature = await signAlchemySignatureRequest({
                walletClient,
                request: current.signatureRequests[0],
                authenticatedWalletAddress,
            })
            current = assertAlchemyPackage(
                await continuePermit(permitSignature),
                authenticatedWalletAddress,
            )
            if (current.stage !== 'sign') {
                throw signingError(
                    'ALCHEMY_PREPARED_CALL_INVALID',
                    'Alchemy did not return the final operation after the gas-token permit.',
                    { stage: 'alchemy.permit' },
                )
            }
        }

        const signatures = []
        for (const request of current.signatureRequests) {
            signatures.push(await signAlchemySignatureRequest({
                walletClient,
                request,
                authenticatedWalletAddress,
            }))
        }
        const result = await submitSignedTransaction(signatures)
        gasAssistTrace('signing.alchemy.success', {
            orderId: current.orderId,
            paymentMode: current.paymentMode,
            signatureCount: signatures.length,
        })
        return result
    } catch (error) {
        gasAssistTraceError('signing.alchemy.error', error, { orderId: current?.orderId })
        throw error
    }
}

export const rawSigningInternals = {
    ALCHEMY_AUTH_SIGN_METHOD,
    ALCHEMY_CONTINUE_PERMIT,
    assertAlchemyPackage,
    signAlchemySignatureRequest,
    supportedConnectorIds: SUPPORTED_CONNECTOR_IDS,
    transactionSummary,
}
