import {
    normalizePreparedAtomicTransaction,
    normalizePreparedSponsoredTransaction,
    validateSignedAtomicTransaction,
    validateSignedPreparedTransaction,
} from '../../gas-assist/services/metamaskMultichain.js'
import {
    describeTransactionReview,
    validateLocallySignedTransaction,
} from './transactionValidation.js'

const EXPECTED_ACTIONS = Object.freeze([
    'fee-payment-transfer',
    'token-approval',
    'normal-swap',
])
const MAX_PACKAGE_CHARS = 512 * 1024

function packageError(code, message) {
    const error = new Error(message)
    error.code = code
    return error
}

function validFutureTimestamp(value) {
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) && timestamp > Date.now()
}

function serializedLength(value) {
    try {
        return JSON.stringify(value).length
    } catch {
        return Number.POSITIVE_INFINITY
    }
}

function chainIdNumber(value) {
    try {
        return Number(
            typeof value === 'string' && /^0x[0-9a-f]+$/iu.test(value)
                ? BigInt(value)
                : value,
        )
    } catch {
        return NaN
    }
}

export function normalizeMegaFuelPackage(preparedPackage, walletAddress) {
    if (serializedLength(preparedPackage) > MAX_PACKAGE_CHARS) {
        throw packageError(
            'PISTACHIO_REQUEST_TOO_LARGE',
            'The Gas Assist package exceeds the Pistachio Wallet safety limit.',
        )
    }
    if (!preparedPackage || typeof preparedPackage !== 'object' || Array.isArray(preparedPackage)) {
        throw packageError('SPONSORSHIP_PACKAGE_INVALID', 'The Gas Assist package is invalid.')
    }
    if (typeof preparedPackage.orderId !== 'string' || !preparedPackage.orderId || preparedPackage.orderId.length > 160) {
        throw packageError('SPONSORSHIP_PACKAGE_INVALID', 'The Gas Assist package has an invalid order ID.')
    }
    if (!validFutureTimestamp(preparedPackage.expiresAt)) {
        throw packageError('INTENT_EXPIRED', 'The Gas Assist package expired.')
    }
    if (!Array.isArray(preparedPackage.transactions) || preparedPackage.transactions.length !== EXPECTED_ACTIONS.length) {
        throw packageError('SPONSORSHIP_PACKAGE_INVALID', 'The Gas Assist package must contain exactly three transactions.')
    }

    const byAction = new Map()
    for (const item of preparedPackage.transactions) {
        if (!item || typeof item !== 'object' || Array.isArray(item) ||
            typeof item.action !== 'string' || byAction.has(item.action)) {
            throw packageError('SPONSORSHIP_PACKAGE_INVALID', 'The Gas Assist package contains duplicate or malformed actions.')
        }
        byAction.set(item.action, item)
    }
    if (EXPECTED_ACTIONS.some((action) => !byAction.has(action))) {
        throw packageError('SPONSORSHIP_PACKAGE_INVALID', 'The Gas Assist package is incomplete.')
    }

    const ordered = EXPECTED_ACTIONS.map((action) => byAction.get(action))
    const intentIds = new Set()
    const normalized = ordered.map((item) => {
        if (typeof item.intentId !== 'string' || !item.intentId || item.intentId.length > 160 || intentIds.has(item.intentId)) {
            throw packageError('SPONSORSHIP_PACKAGE_INVALID', 'The Gas Assist package contains duplicate or invalid intent IDs.')
        }
        intentIds.add(item.intentId)
        if (!validFutureTimestamp(item.expiresAt)) {
            throw packageError('INTENT_EXPIRED', `The ${item.action} Gas Assist intent expired.`)
        }
        if (Date.parse(item.expiresAt) > Date.parse(preparedPackage.expiresAt)) {
            throw packageError('SPONSORSHIP_PACKAGE_INVALID', 'A Gas Assist intent outlives its package expiry.')
        }
        if (chainIdNumber(item.transaction?.chainId) !== 56) {
            throw packageError('PISTACHIO_CHAIN_INVARIANT_FAILED', 'Gas Assist package transactions must use BNB Chain.')
        }
        return {
            action: item.action,
            intentId: item.intentId,
            expiresAt: item.expiresAt,
            transaction: normalizePreparedSponsoredTransaction(item.transaction, walletAddress),
        }
    })

    let nonces
    try {
        nonces = normalized.map((item) => BigInt(item.transaction.nonce))
    } catch {
        throw packageError('SPONSORSHIP_PACKAGE_INVALID', 'The Gas Assist package contains an invalid nonce.')
    }
    if (nonces[1] !== nonces[0] + 1n || nonces[2] !== nonces[0] + 2n) {
        throw packageError('SPONSORSHIP_PACKAGE_NONCE_MISMATCH', 'Gas Assist package transactions must use consecutive nonces.')
    }

    return Object.freeze({
        orderId: preparedPackage.orderId,
        expiresAt: preparedPackage.expiresAt,
        transactions: normalized.map((item) => Object.freeze(item)),
    })
}

export const methods = {
    async signAtomicMegaFuel(prepared) {
        const reviewWalletAddress = this.phase === 'unlocked' && this.address
            ? this.address
            : this.sessionActive && this.vault?.address
                ? this.vault.address
                : null
        if (!reviewWalletAddress) {
            throw packageError(
                'PISTACHIO_WALLET_LOCKED',
                'Connect Pistachio Wallet before signing a Gas Assist swap.',
            )
        }
        if (!prepared || typeof prepared !== 'object' || Array.isArray(prepared)) {
            throw packageError('SPONSORSHIP_PACKAGE_INVALID', 'The atomic Gas Assist payload is invalid.')
        }
        if (prepared.execution !== 'atomic' || prepared.mode !== 'eip7702' ||
            prepared.action !== 'atomic-swap') {
            throw packageError('SPONSORSHIP_PACKAGE_INVALID', 'The payload is not a direct EIP-7702 Gas Assist swap.')
        }
        if (typeof prepared.orderId !== 'string' || !prepared.orderId || prepared.orderId.length > 160) {
            throw packageError('SPONSORSHIP_PACKAGE_INVALID', 'The atomic Gas Assist swap has an invalid order ID.')
        }
        if (!validFutureTimestamp(prepared.expiresAt)) {
            throw packageError('INTENT_EXPIRED', 'The atomic Gas Assist swap expired.')
        }
        if (Number(prepared.chainId) !== 56) {
            throw packageError('PISTACHIO_CHAIN_INVARIANT_FAILED', 'Atomic Gas Assist must use BNB Chain.')
        }
        if (serializedLength(prepared) > MAX_PACKAGE_CHARS) {
            throw packageError(
                'PISTACHIO_REQUEST_TOO_LARGE',
                'The Gas Assist payload exceeds the Pistachio Wallet safety limit.',
            )
        }
        const transaction = normalizePreparedAtomicTransaction(
            prepared.transaction,
            reviewWalletAddress,
        )
        if (String(prepared.recipient).toLowerCase() !== String(reviewWalletAddress).toLowerCase()) {
            throw packageError(
                'WALLET_SIGNER_MISMATCH',
                'Atomic Gas Assist bought tokens must return to the signing wallet.',
            )
        }

        const previouslyAuthorized = this.hasActiveGasAssistAuthorization?.() === true
        if (!previouslyAuthorized) {
            await this.reviewQueue.request({
                walletAddress: reviewWalletAddress,
                chainId: 56,
                action: 'Confirm Gas Assist swap',
                payload: {
                    purpose: 'One sponsored BNB Chain transaction. The Gas Assist fee is already in the quote. If the swap fails, no fee is taken.',
                    orderId: prepared.orderId,
                    expiresAt: prepared.expiresAt,
                    feeRecipient: prepared.feeRecipient,
                    paymentAmountRaw: prepared.paymentAmountRaw,
                    minOutRaw: prepared.minOutRaw,
                    recipient: prepared.recipient,
                    mode: prepared.mode,
                    ...describeTransactionReview(transaction, 'megafuel'),
                },
            })
        }

        await this.ensureUnlockedForSigning()
        const context = this.captureSigningContext(56)
        if (String(context.address).toLowerCase() !== String(reviewWalletAddress).toLowerCase()) {
            throw packageError(
                'PISTACHIO_SIGNING_CONTEXT_CHANGED',
                'The active wallet changed after the Gas Assist review.',
            )
        }
        this.assertSigningContext(context)
        if (!validFutureTimestamp(prepared.expiresAt)) {
            throw packageError('INTENT_EXPIRED', 'The atomic Gas Assist swap expired before signing completed.')
        }

        let signedRawTransaction = null
        try {
            signedRawTransaction = (
                await this.client.request('signTransaction', {
                    transaction,
                    mode: 'megafuel',
                })
            ).signedTransaction
            this.assertSigningContext(context)
            await validateLocallySignedTransaction({
                signedTransaction: signedRawTransaction,
                request: transaction,
                walletAddress: context.address,
                mode: 'megafuel',
            })
            await validateSignedAtomicTransaction({
                signedRawTransaction,
                normalizedTransaction: transaction,
                authenticatedWalletAddress: context.address,
                feeRecipient: prepared.feeRecipient,
                minOutRaw: prepared.minOutRaw,
                recipient: prepared.recipient,
            })
            await this.recordActivity()
            return {
                orderId: prepared.orderId,
                intentId: prepared.intentId,
                signedRawTransaction,
            }
        } finally {
            signedRawTransaction = null
        }
    },
}

export const megaFuelPackageSigningInternals = {
    EXPECTED_ACTIONS,
    MAX_PACKAGE_CHARS,
    chainIdNumber,
    serializedLength,
    validFutureTimestamp,
}
