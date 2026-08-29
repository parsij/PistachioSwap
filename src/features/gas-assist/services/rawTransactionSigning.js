import {
    normalizePreparedAtomicTransaction,
    normalizePreparedSponsoredTransaction,
    validateSignedAtomicTransaction,
    validateSignedPreparedTransaction,
} from './metamaskMultichain.js'
import {
    gasAssistTrace,
    gasAssistTraceError,
} from './gasAssistTrace.js'

const SUPPORTED_CONNECTOR_IDS = new Set([
    'pistachio-local',
])
const ATOMIC_SIGN_METHOD = 'pistachio_signAtomicMegaFuel'

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

/** Derives raw-transaction signing capability without prompting the connected wallet. */
export function detectRawTransactionSigning({ connector, walletClient }) {
    const connectorId = String(connector?.id ?? '').trim().toLowerCase()
    const supported =
        SUPPORTED_CONNECTOR_IDS.has(connectorId) &&
        typeof walletClient?.request === 'function'
    const transport = supported ? 'pistachio-local' : null
    const result = Object.freeze({
        rawTransactionSigningSupported: supported,
        method: supported ? 'eth_signTransaction' : null,
        atomicMethod: supported ? ATOMIC_SIGN_METHOD : null,
        transport,
        status: supported ? 'verified' : 'unsupported',
        scope: supported ? 'eip155:56' : null,
        account: null,
        approvedMethods: supported
            ? ['eth_signTransaction', ATOMIC_SIGN_METHOD]
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
 * Requests raw transaction signing from Pistachio Wallet.
 * @returns {Promise<string>} Signed serialized transaction bytes.
 * @throws A safe capability, account-binding, or wallet-signing error.
 * @sideEffects Displays the Pistachio Wallet transaction review when explicitly invoked.
 */
export async function signRawSponsoredTransaction({
    capability,
    walletClient,
    transaction,
    action = 'sponsored-transaction',
}) {
    if (
        capability?.rawTransactionSigningSupported !== true ||
        capability.method !== 'eth_signTransaction' ||
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
    let signedRawTransaction
    try {
        signedRawTransaction = await walletClient.request({
            method: 'eth_signTransaction',
            params: [transaction],
        })
    } catch (error) {
        gasAssistTraceError('signing.wallet-request.error', error, {
            action,
            transaction: transactionSummary(transaction),
        })
        throw error
    }
    if (typeof signedRawTransaction !== 'string' ||
        !/^0x(?:[0-9a-f]{2})+$/i.test(signedRawTransaction)) {
        throw signingError(
            'WALLET_RAW_TRANSACTION_MALFORMED',
            'Pistachio Wallet returned an invalid signed transaction.',
            { stage: 'wallet.sign', action },
        )
    }
    gasAssistTrace('signing.wallet-request.success', {
        action,
        signedBytes: (signedRawTransaction.length - 2) / 2,
    })
    return signedRawTransaction
}

/** Signs and validates the exact backend-prepared sponsored transaction. */
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
            'A direct sponsorship submission callback is required.',
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

    gasAssistTrace('signing.intent.normalize.start', { action })
    const normalizedTransaction = normalizePreparedSponsoredTransaction(
        preparedTransaction,
        authenticatedWalletAddress,
    )
    gasAssistTrace('signing.intent.normalize.success', {
        action,
        transaction: transactionSummary(normalizedTransaction),
    })

    let signedRawTransaction = null
    try {
        signedRawTransaction = await signRawSponsoredTransaction({
            capability,
            walletClient,
            transaction: normalizedTransaction,
            action,
        })
        gasAssistTrace('signing.intent.validate.start', { action })
        await validateSignedPreparedTransaction({
            signedRawTransaction,
            normalizedTransaction,
            authenticatedWalletAddress,
            multichainAccount: multichainAccount ?? authenticatedWalletAddress,
        })
        gasAssistTrace('signing.intent.validate.success', { action })
        gasAssistTrace('signing.intent.submit.start', { action })
        const result = await submitSignedTransaction(signedRawTransaction)
        gasAssistTrace('signing.intent.submit.success', { action })
        return result
    } catch (error) {
        gasAssistTraceError('signing.intent.error', error, { action })
        throw error
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
        capability?.atomicMethod !== ATOMIC_SIGN_METHOD ||
        typeof walletClient?.request !== 'function' ||
        typeof submitSignedTransaction !== 'function'
    ) {
        throw signingError(
            'PISTACHIO_WALLET_REQUIRED',
            'Atomic Gas Assist requires Pistachio Wallet.',
            { stage: 'atomic.validate' },
        )
    }
    if (prepared?.execution !== 'atomic' || prepared?.mode !== 'eip7702' ||
        prepared?.action !== 'atomic-swap' ||
        prepared?.chainId !== 56) {
        throw signingError(
            'ATOMIC_PATH_UNAVAILABLE',
            'Gas Assist did not return a direct BNB Chain EIP-7702 transaction.',
            { stage: 'atomic.validate' },
        )
    }
    if (!Number.isFinite(Date.parse(prepared.expiresAt)) || Date.parse(prepared.expiresAt) <= Date.now()) {
        throw signingError(
            'INTENT_EXPIRED',
            'The atomic Gas Assist swap expired or is malformed.',
            { stage: 'atomic.validate' },
        )
    }
    const normalizedTransaction = normalizePreparedAtomicTransaction(
        prepared.transaction,
        authenticatedWalletAddress,
    )
    if (String(prepared.recipient).toLowerCase() !== String(authenticatedWalletAddress).toLowerCase()) {
        throw signingError(
            'WALLET_SIGNER_MISMATCH',
            'Atomic Gas Assist bought tokens must return to the signing wallet.',
            { stage: 'atomic.validate' },
        )
    }

    gasAssistTrace('signing.atomic.start', {
        orderId: prepared.orderId,
        mode: prepared.mode,
        transaction: transactionSummary(normalizedTransaction),
    })
    let signedRawTransaction = null
    try {
        const response = await walletClient.request({
            method: ATOMIC_SIGN_METHOD,
            params: [{
                ...prepared,
                transaction: normalizedTransaction,
            }],
        })
        signedRawTransaction = typeof response === 'string'
            ? response
            : response?.signedRawTransaction
        if (typeof signedRawTransaction !== 'string' ||
            !/^0x(?:[0-9a-f]{2})+$/i.test(signedRawTransaction)) {
            throw signingError(
                'WALLET_RAW_TRANSACTION_MALFORMED',
                'Pistachio Wallet returned an invalid atomic signature.',
                { stage: 'atomic.sign' },
            )
        }
        await validateSignedAtomicTransaction({
            signedRawTransaction,
            normalizedTransaction,
            authenticatedWalletAddress,
            feeRecipient: prepared.feeRecipient,
            minOutRaw: prepared.minOutRaw,
            recipient: prepared.recipient,
        })
        const result = await submitSignedTransaction(signedRawTransaction)
        gasAssistTrace('signing.atomic.success', { orderId: prepared.orderId })
        return result
    } catch (error) {
        gasAssistTraceError('signing.atomic.error', error, { orderId: prepared?.orderId })
        throw error
    } finally {
        signedRawTransaction = null
    }
}

export const rawSigningInternals = {
    ATOMIC_SIGN_METHOD,
    supportedConnectorIds: SUPPORTED_CONNECTOR_IDS,
    transactionSummary,
}
