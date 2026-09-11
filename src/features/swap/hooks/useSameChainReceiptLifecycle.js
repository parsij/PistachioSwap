import { useCallback, useEffect, useRef, useState } from 'react'
import { useWaitForTransactionReceipt } from '#wallet-runtime'
import { formatUnits } from 'viem'

import { recordWalletActivity } from '../../wallet/services/walletActivity.js'
import {
    beginOptimisticWalletTransaction,
    finishOptimisticWalletTransaction,
    rollbackOptimisticWalletTransaction,
} from '../../wallet/services/optimisticBalances.js'

const POST_SWAP_REFRESH_DELAYS_MS = Object.freeze([2_000, 8_000])
const OPTIMISTIC_SETTLE_DELAY_MS = 9_000
const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'

function rawAmount(value) {
    try {
        return BigInt(value ?? 0)
    } catch {
        return 0n
    }
}

function activityAmount(value, decimals) {
    try {
        return formatUnits(BigInt(value), Number(decimals))
    } catch {
        return null
    }
}

/**
 * Owns same-chain transaction hash/status and applies the existing receipt side effects once.
 * Pending balance deltas and semantic swap activity are painted as soon as the
 * wallet returns a submitted transaction hash, then reconciled after settlement.
 */
export function useSameChainReceiptLifecycle({
    chainId,
    account,
    walletChainId,
    executionMode,
    sellToken,
    buyToken,
    quote,
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
    const refreshTimersRef = useRef(new Set())
    const optimisticHashRef = useRef(null)
    const receipt = useWaitForTransactionReceipt({
        hash: transactionHash ?? undefined,
        chainId,
        query: { enabled: Boolean(transactionHash) },
    })

    const clearRefreshTimers = useCallback(() => {
        for (const timer of refreshTimersRef.current) globalThis.clearTimeout(timer)
        refreshTimersRef.current.clear()
    }, [])

    const refreshSettledWallet = useCallback(() => {
        void refreshWalletBalances()
        for (const delay of POST_SWAP_REFRESH_DELAYS_MS) {
            const timer = globalThis.setTimeout(() => {
                refreshTimersRef.current.delete(timer)
                void refreshWalletBalances()
            }, delay)
            refreshTimersRef.current.add(timer)
        }
    }, [refreshWalletBalances])

    useEffect(() => clearRefreshTimers, [account, clearRefreshTimers])

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
        if (!transactionHash || transactionStatus !== 'submitted' || !account) return
        if (optimisticHashRef.current?.toLowerCase() === transactionHash.toLowerCase()) return

        const selectedQuote = quote?.selectedQuote
        const sellAmountRaw = rawAmount(selectedQuote?.sellAmount)
        const buyAmountRaw = rawAmount(selectedQuote?.buyAmount)
        if (!sellToken || !buyToken || sellAmountRaw <= 0n || buyAmountRaw <= 0n) return

        const changes = [
            { chainId, token: sellToken, deltaRaw: -sellAmountRaw },
            { chainId, token: buyToken, deltaRaw: buyAmountRaw },
        ]

        const transaction = selectedQuote?.transaction
        const gas = rawAmount(transaction?.gas)
        const gasPrice = rawAmount(transaction?.gasPrice ?? transaction?.maxFeePerGas)
        const estimatedNativeFee = gas > 0n && gasPrice > 0n ? gas * gasPrice : 0n
        if (estimatedNativeFee > 0n) {
            changes.push({
                chainId,
                tokenAddress: NATIVE_TOKEN_ADDRESS,
                deltaRaw: -estimatedNativeFee,
            })
        }

        beginOptimisticWalletTransaction({
            walletAddress: account,
            transactionHash,
            operation: 'swapping',
            changes,
        })
        optimisticHashRef.current = transactionHash

        recordWalletActivity({
            walletAddress: account,
            chainId,
            type: 'swapped',
            hash: transactionHash,
            sellToken,
            buyToken,
            sellAmount: activityAmount(sellAmountRaw, sellToken.decimals),
            buyAmount: activityAmount(buyAmountRaw, buyToken.decimals),
            status: 'pending',
        })
    }, [
        account,
        buyToken,
        chainId,
        quote,
        sellToken,
        transactionHash,
        transactionStatus,
    ])

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
            setVisibleStatus('Swap confirmed. Updating wallet balances…')
            diagnostic('receipt.confirmed', { hash: transactionHash, chainId })
            recordWalletActivity({
                walletAddress: account,
                chainId,
                type: 'swapped',
                hash: transactionHash,
                sellToken,
                buyToken,
                sellAmount: activityAmount(quote?.selectedQuote?.sellAmount, sellToken?.decimals),
                buyAmount: activityAmount(quote?.selectedQuote?.buyAmount, buyToken?.decimals),
                status: 'confirmed',
            })
            closeReview()
            resetInputsAfterSuccess()
            invalidateQuoteAfterSuccess()
            refreshSettledWallet()
            const timer = globalThis.setTimeout(() => {
                refreshTimersRef.current.delete(timer)
                finishOptimisticWalletTransaction(transactionHash)
                if (optimisticHashRef.current?.toLowerCase() === transactionHash.toLowerCase()) {
                    optimisticHashRef.current = null
                }
            }, OPTIMISTIC_SETTLE_DELAY_MS)
            refreshTimersRef.current.add(timer)
        }

        if (receipt.isError && transactionStatus === 'submitted') {
            rollbackOptimisticWalletTransaction(transactionHash)
            if (optimisticHashRef.current?.toLowerCase() === transactionHash.toLowerCase()) {
                optimisticHashRef.current = null
            }
            recordWalletActivity({
                walletAddress: account,
                chainId,
                type: 'swapped',
                hash: transactionHash,
                sellToken,
                buyToken,
                sellAmount: activityAmount(quote?.selectedQuote?.sellAmount, sellToken?.decimals),
                buyAmount: activityAmount(quote?.selectedQuote?.buyAmount, buyToken?.decimals),
                status: 'failed',
            })
            setTransactionStatus('failed')
            setVisibleStatus('The transaction failed before confirmation.')
            setReviewError('The transaction failed before confirmation.')
            setReviewOperation('idle')
            diagnostic('receipt.failed', { hash: transactionHash, chainId }, 'error')
        }
    }, [
        account,
        buyToken,
        chainId,
        closeReview,
        diagnostic,
        invalidateQuoteAfterSuccess,
        quote,
        receipt.isError,
        receipt.isSuccess,
        refreshSettledWallet,
        resetInputsAfterSuccess,
        sellToken,
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
