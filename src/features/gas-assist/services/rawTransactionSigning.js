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
        transport,
        status: supported ? 'verified' : 'unsupported',
        scope: supported ? 'eip155:56' : null,
        account: null,
        approvedMethods: supported ? ['eth_signTransaction'] : [],
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

function orderedPackageTransactions(preparedPackage) {
    const expectedActions = [
        'fee-payment-transfer',
        'token-approval',
        'normal-swap',
    ]
    if (!Array.isArray(preparedPackage?.transactions) ||
        preparedPackage.transactions.length !== expectedActions.length) {
        throw signingError(
            'SPONSORSHIP_PACKAGE_INVALID',
            'The prepared Gas Assist package is invalid.',
            { stage: 'package.validate' },
        )
    }
    if (!Number.isFinite(Date.parse(preparedPackage.expiresAt)) ||
        Date.parse(preparedPackage.expiresAt) <= Date.now()) {
        throw signingError(
            'INTENT_EXPIRED',
            'The prepared Gas Assist package expired.',
            { stage: 'package.validate' },
        )
    }

    const byAction = new Map(
        preparedPackage.transactions.map((item) => [item.action, item]),
    )
    if (byAction.size !== expectedActions.length ||
        expectedActions.some((action) => !byAction.has(action))) {
        throw signingError(
            'SPONSORSHIP_PACKAGE_INVALID',
            'The prepared Gas Assist package is incomplete.',
            { stage: 'package.validate' },
        )
    }
    const ordered = expectedActions.map((action) => byAction.get(action))
    const intentIds = new Set(ordered.map((item) => item.intentId))
    if (intentIds.size !== expectedActions.length ||
        ordered.some((item) => typeof item.intentId !== 'string' || !item.intentId)) {
        throw signingError(
            'SPONSORSHIP_PACKAGE_INVALID',
            'The prepared Gas Assist package contains duplicate or missing intents.',
            { stage: 'package.validate' },
        )
    }

    let nonces
    try {
        nonces = ordered.map((item) => BigInt(item.transaction?.nonce))
    } catch {
        throw signingError(
            'SPONSORSHIP_PACKAGE_INVALID',
            'The prepared Gas Assist package contains an invalid nonce.',
            { stage: 'package.validate' },
        )
    }
    if (nonces[1] !== nonces[0] + 1n || nonces[2] !== nonces[0] + 2n) {
        throw signingError(
            'SPONSORSHIP_PACKAGE_NONCE_MISMATCH',
            'The prepared Gas Assist transactions do not use consecutive nonces.',
            { stage: 'package.validate', nonces },
        )
    }
    return ordered
}

export async function signPreparedSponsoredPackage({
    transport,
    capability,
    walletClient,
    preparedPackage,
    authenticatedWalletAddress,
    multichainAccount,
    submitSignedPackage,
}) {
    if (transport !== 'pistachio-local' || typeof submitSignedPackage !== 'function') {
        throw signingError(
            'SPONSORSHIP_PACKAGE_INVALID',
            'The prepared Gas Assist package is invalid.',
            { stage: 'package.validate' },
        )
    }

    gasAssistTrace('signing.package.validate.start', {
        orderId: preparedPackage?.orderId,
    })
    const ordered = orderedPackageTransactions(preparedPackage)
    gasAssistTrace('signing.package.validate.success', {
        orderId: preparedPackage.orderId,
        actions: ordered.map((item) => item.action),
        nonces: ordered.map((item) => item.transaction.nonce),
    })

    const signedTransactions = []
    try {
        for (const intent of ordered) {
            const action = intent.action
            if (!Number.isFinite(Date.parse(intent.expiresAt)) ||
                Date.parse(intent.expiresAt) <= Date.now()) {
                throw signingError(
                    'INTENT_EXPIRED',
                    `The ${action} signing intent expired.`,
                    { stage: 'package.sign', action },
                )
            }
            gasAssistTrace('signing.package.transaction.start', {
                orderId: preparedPackage.orderId,
                action,
            })
            const normalizedTransaction = normalizePreparedSponsoredTransaction(
                intent.transaction,
                authenticatedWalletAddress,
            )
            const signedRawTransaction = await signRawSponsoredTransaction({
                capability,
                walletClient,
                transaction: normalizedTransaction,
                action,
            })
            gasAssistTrace('signing.package.transaction.validate.start', {
                orderId: preparedPackage.orderId,
                action,
            })
            await validateSignedPreparedTransaction({
                signedRawTransaction,
                normalizedTransaction,
                authenticatedWalletAddress,
                multichainAccount: multichainAccount ?? authenticatedWalletAddress,
            })
            signedTransactions.push({
                intentId: intent.intentId,
                action,
                signedRawTransaction,
            })
            gasAssistTrace('signing.package.transaction.success', {
                orderId: preparedPackage.orderId,
                action,
            })
        }
        gasAssistTrace('signing.package.submit.start', {
            orderId: preparedPackage.orderId,
            transactionCount: signedTransactions.length,
        })
        const result = await submitSignedPackage(
            signedTransactions.map((transaction) => ({ ...transaction })),
        )
        gasAssistTrace('signing.package.submit.success', {
            orderId: preparedPackage.orderId,
        })
        return result
    } catch (error) {
        gasAssistTraceError('signing.package.error', error, {
            orderId: preparedPackage?.orderId,
            completedActions: signedTransactions.map((item) => item.action),
        })
        throw error
    } finally {
        signedTransactions.splice(0, signedTransactions.length)
    }
}

export const rawSigningInternals = {
    supportedConnectorIds: SUPPORTED_CONNECTOR_IDS,
    orderedPackageTransactions,
    transactionSummary,
}
