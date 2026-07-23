import { useCallback, useEffect, useState } from 'react'
import { useWaitForTransactionReceipt } from 'wagmi'

import { recordWalletActivity } from '../../wallet/services/walletActivity.js'

/**
 * Owns same-chain transaction hash/status and applies the existing receipt side effects once.
 *
 * @param {object} config Hook dependencies.
 * @param {number} config.chainId Expected receipt chain.
 * @param {string|null} config.account Connected account; changes reset the lifecycle.
 * @param {number|null} config.walletChainId Connected wallet chain; changes reset the lifecycle.
 * @param {string} config.executionMode Active execution mode; changes reset hash/status.
 * @param {(message: string|null) => void} config.setVisibleStatus Updates the shared visible status.
 * @param {() => void} config.closeReview Closes and restores focus for same-chain review.
 * @param {() => void} config.resetInputsAfterSuccess Clears sell/buy inputs.
 * @param {() => void} config.invalidateQuoteAfterSuccess Clears the executed quote.
 * @param {() => Promise<unknown>} config.refreshWalletBalances Refreshes native/token balances.
 * @param {(message: string|null) => void} config.setReviewError Updates visible review error.
 * @param {(operation: string) => void} config.setReviewOperation Updates review progress.
 * @param {(event: string, payload?: object, level?: string) => void} config.diagnostic Existing logger.
 * @returns {{transactionHash: string|null, transactionStatus: string, setTransactionHash: Function, setTransactionStatus: Function, resetReceiptLifecycle: Function}} Public lifecycle API.
 * @sideEffects Uses Wagmi receipt polling; success closes review, records activity, resets inputs/quote, and refreshes balances.
 * @throws Does not throw receipt errors; maps them to existing state and diagnostics.
 * @security Assumes the supplied hash was produced by the validated same-chain submission path.
 */
export function useSameChainReceiptLifecycle({
    chainId,
    account,
    walletChainId,
    executionMode,
    setVisibleStatus,
    closeReview,
    resetInputsAfterSuccess,
    invalidateQuoteAfterSuccess,
    refreshWalletBalances,
    setReviewError,
    setReviewOperation,
    diagnostic,
}) {
    const [transactionHash, setTransactionHash] = useState(null)
    const [transactionStatus, setTransactionStatus] = useState('idle')
    const receipt = useWaitForTransactionReceipt({
        hash: transactionHash ?? undefined,
        chainId,
        query: { enabled: Boolean(transactionHash) },
    })

    const resetReceiptLifecycle = useCallback(() => {
        setTransactionHash(null)
        setTransactionStatus('idle')
    }, [])

    useEffect(() => {
        resetReceiptLifecycle()
    }, [executionMode, resetReceiptLifecycle])

    useEffect(() => {
        resetReceiptLifecycle()
        setVisibleStatus(null)
    }, [account, resetReceiptLifecycle, setVisibleStatus, walletChainId])

    useEffect(() => {
        if (!transactionHash) return
        diagnostic('receipt.monitor.tick', {
            hash: transactionHash,
            chainId,
            transactionStatus,
            receiptSuccess: receipt.isSuccess,
            receiptError: receipt.isError,
        })

        if (receipt.isSuccess && transactionStatus === 'submitted') {
            setTransactionStatus('confirmed')
            setVisibleStatus('Swap confirmed.')
            diagnostic('receipt.confirmed', { hash: transactionHash, chainId })
            recordWalletActivity({
                walletAddress: account,
                chainId,
                type: 'swapped',
                hash: transactionHash,
            })
            closeReview()
            resetInputsAfterSuccess()
            invalidateQuoteAfterSuccess()
            void refreshWalletBalances()
        }

        if (receipt.isError && transactionStatus === 'submitted') {
            setTransactionStatus('failed')
            setVisibleStatus('The transaction failed before confirmation.')
            setReviewError('The transaction failed before confirmation.')
            setReviewOperation('idle')
            diagnostic('receipt.failed', { hash: transactionHash, chainId }, 'error')
        }
    }, [
        account,
        chainId,
        closeReview,
        diagnostic,
        invalidateQuoteAfterSuccess,
        receipt.isError,
        receipt.isSuccess,
        refreshWalletBalances,
        resetInputsAfterSuccess,
        setReviewError,
        setReviewOperation,
        setVisibleStatus,
        transactionHash,
        transactionStatus,
    ])

    return {
        transactionHash,
        transactionStatus,
        setTransactionHash,
        setTransactionStatus,
        resetReceiptLifecycle,
    }
}
