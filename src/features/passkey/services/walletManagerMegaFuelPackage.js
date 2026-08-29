import {
    normalizePreparedAtomicTransaction,
    validateSignedAtomicTransaction,
} from '../../gas-assist/services/metamaskMultichain.js'
import {
    describeTransactionReview,
    validateLocallySignedTransaction,
} from './transactionValidation.js'

const MAX_ATOMIC_PAYLOAD_CHARS = 512 * 1024

function atomicError(code, message) {
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

export const methods = {
    async signAtomicMegaFuel(prepared) {
        const reviewWalletAddress = this.phase === 'unlocked' && this.address
            ? this.address
            : this.sessionActive && this.vault?.address
                ? this.vault.address
                : null
        if (!reviewWalletAddress) {
            throw atomicError(
                'PISTACHIO_WALLET_LOCKED',
                'Connect Pistachio Wallet before signing a Gas Assist swap.',
            )
        }
        if (!prepared || typeof prepared !== 'object' || Array.isArray(prepared)) {
            throw atomicError('SPONSORSHIP_PACKAGE_INVALID', 'The atomic Gas Assist payload is invalid.')
        }
        if (prepared.execution !== 'atomic' || prepared.mode !== 'eip7702' ||
            prepared.action !== 'atomic-swap') {
            throw atomicError('SPONSORSHIP_PACKAGE_INVALID', 'The payload is not a direct EIP-7702 Gas Assist swap.')
        }
        if (typeof prepared.orderId !== 'string' || !prepared.orderId || prepared.orderId.length > 160) {
            throw atomicError('SPONSORSHIP_PACKAGE_INVALID', 'The atomic Gas Assist swap has an invalid order ID.')
        }
        if (!validFutureTimestamp(prepared.expiresAt)) {
            throw atomicError('INTENT_EXPIRED', 'The atomic Gas Assist swap expired.')
        }
        if (Number(prepared.chainId) !== 56) {
            throw atomicError('PISTACHIO_CHAIN_INVARIANT_FAILED', 'Atomic Gas Assist must use BNB Chain.')
        }
        if (serializedLength(prepared) > MAX_ATOMIC_PAYLOAD_CHARS) {
            throw atomicError(
                'PISTACHIO_REQUEST_TOO_LARGE',
                'The Gas Assist payload exceeds the Pistachio Wallet safety limit.',
            )
        }
        const transaction = normalizePreparedAtomicTransaction(
            prepared.transaction,
            reviewWalletAddress,
        )
        if (String(prepared.recipient).toLowerCase() !== String(reviewWalletAddress).toLowerCase()) {
            throw atomicError(
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
                    purpose: 'One sponsored BNB Chain transaction. The disclosed Gas Assist fee is paid directly to PistachioSwap, while the swap principal goes directly through the quoted router. If the swap fails, no fee is taken.',
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
            throw atomicError(
                'PISTACHIO_SIGNING_CONTEXT_CHANGED',
                'The active wallet changed after the Gas Assist review.',
            )
        }
        this.assertSigningContext(context)
        if (!validFutureTimestamp(prepared.expiresAt)) {
            throw atomicError('INTENT_EXPIRED', 'The atomic Gas Assist swap expired before signing completed.')
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
    MAX_ATOMIC_PAYLOAD_CHARS,
    serializedLength,
    validFutureTimestamp,
}
