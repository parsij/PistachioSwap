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
const PACKAGE_SIGN_METHOD = 'pistachio_signMegaFuelPackage'
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
        packageMethod: supported ? PACKAGE_SIGN_METHOD : null,
        atomicMethod: supported ? ATOMIC_SIGN_METHOD : null,
        transport,
        status: supported ? 'verified' : 'unsupported',
        scope: supported ? 'eip155:56' : null,
        account: null,
        approvedMethods: supported
            ? ['eth_signTransaction', PACKAGE_SIGN_METHOD, ATOMIC_SIGN_METHOD]
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
    if (typeof preparedPackage?.orderId !== 'string' || !preparedPackage.orderId ||
        !Number.isFinite(Date.parse(preparedPackage.expiresAt)) ||
        Date.parse(preparedPackage.expiresAt) <= Date.now()) {
        throw signingError(
            'INTENT_EXPIRED',
            'The prepared Gas Assist package expired or is malformed.',
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
        ordered.some((item) => typeof item.intentId !== 'string' || !item.intentId ||
            !Number.isFinite(Date.parse(item.expiresAt)) || Date.parse(item.expiresAt) <= Date.now())) {
        throw signingError(
            'SPONSORSHIP_PACKAGE_INVALID',
            'The prepared Gas Assist package contains duplicate, missing, or expired intents.',
            { stage: 'package.validate' },
        )
    }
    if (ordered.some((item) => Date.parse(item.expiresAt) > Date.parse(preparedPackage.expiresAt))) {
        throw signingError(
            'SPONSORSHIP_PACKAGE_INVALID',
            'A Gas Assist intent outlives the package expiry.',
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

function validatePackageSigningResponse(response, preparedPackage, ordered) {
    if (!response || typeof response !== 'object' || Array.isArray(response) ||
        response.orderId !== preparedPackage.orderId ||
        !Array.isArray(response.signedTransactions) ||
        response.signedTransactions.length !== ordered.length) {
        throw signingError(
            'SPONSORSHIP_PACKAGE_INVALID',
            'Pistachio Wallet returned an invalid Gas Assist package signature response.',
            { stage: 'package.sign' },
        )
    }
    return response.signedTransactions.map((signed, index) => {
        const expected = ordered[index]
        if (!signed || typeof signed !== 'object' || Array.isArray(signed) ||
            signed.action !== expected.action || signed.intentId !== expected.intentId ||
            typeof signed.signedRawTransaction !== 'string' ||
            !/^0x(?:[0-9a-f]{2})+$/iu.test(signed.signedRawTransaction)) {
            throw signingError(
                'SPONSORSHIP_PACKAGE_INVALID',
                'Pistachio Wallet returned mismatched Gas Assist package signatures.',
                { stage: 'package.sign', action: expected.action },
            )
        }
        return {
            intentId: expected.intentId,
            action: expected.action,
            signedRawTransaction: signed.signedRawTransaction,
        }
    })
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
    if (
        transport !== 'pistachio-local' ||
        capability?.packageMethod !== PACKAGE_SIGN_METHOD ||
        typeof walletClient?.request !== 'function' ||
        typeof submitSignedPackage !== 'function'
    ) {
        throw signingError(
            'PISTACHIO_BATCH_SIGNING_REQUIRED',
            'Gas Assist requires the Pistachio Wallet one-confirmation package signer.',
            { stage: 'package.validate' },
        )
    }

    gasAssistTrace('signing.package.validate.start', {
        orderId: preparedPackage?.orderId,
    })
    const ordered = orderedPackageTransactions(preparedPackage)
    const normalizedTransactions = ordered.map((item) =>
        normalizePreparedSponsoredTransaction(
            item.transaction,
            authenticatedWalletAddress,
        ))
    gasAssistTrace('signing.package.validate.success', {
        orderId: preparedPackage.orderId,
        actions: ordered.map((item) => item.action),
        nonces: normalizedTransactions.map((item) => item.nonce),
    })

    let signedTransactions = []
    try {
        gasAssistTrace('signing.package.wallet-request.start', {
            orderId: preparedPackage.orderId,
            transactionCount: ordered.length,
        })
        const response = await walletClient.request({
            method: PACKAGE_SIGN_METHOD,
            params: [preparedPackage],
        })
        signedTransactions = validatePackageSigningResponse(
            response,
            preparedPackage,
            ordered,
        )
        gasAssistTrace('signing.package.wallet-request.success', {
            orderId: preparedPackage.orderId,
            transactionCount: signedTransactions.length,
        })

        for (let index = 0; index < signedTransactions.length; index += 1) {
            const signed = signedTransactions[index]
            const normalizedTransaction = normalizedTransactions[index]
            gasAssistTrace('signing.package.transaction.validate.start', {
                orderId: preparedPackage.orderId,
                action: signed.action,
            })
            await validateSignedPreparedTransaction({
                signedRawTransaction: signed.signedRawTransaction,
                normalizedTransaction,
                authenticatedWalletAddress,
                multichainAccount: multichainAccount ?? authenticatedWalletAddress,
            })
            gasAssistTrace('signing.package.transaction.validate.success', {
                orderId: preparedPackage.orderId,
                action: signed.action,
            })
        }

        if (!Number.isFinite(Date.parse(preparedPackage.expiresAt)) ||
            Date.parse(preparedPackage.expiresAt) <= Date.now()) {
            throw signingError(
                'INTENT_EXPIRED',
                'The signed Gas Assist package expired before submission.',
                { stage: 'package.submit' },
            )
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
    if (prepared?.execution !== 'atomic' || prepared?.action !== 'atomic-swap' ||
        prepared?.chainId !== 56) {
        throw signingError(
            'ATOMIC_PATH_UNAVAILABLE',
            'Gas Assist did not return a BNB Chain atomic sponsored transaction.',
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
    PACKAGE_SIGN_METHOD,
    ATOMIC_SIGN_METHOD,
    supportedConnectorIds: SUPPORTED_CONNECTOR_IDS,
    orderedPackageTransactions,
    transactionSummary,
    validatePackageSigningResponse,
}
