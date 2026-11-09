import { useCallback, useEffect, useMemo, useRef } from 'react'
import { formatUnits } from 'viem'
import { usePrepaidSponsorship } from './usePrepaidSponsorship.js'
import { useSponsorshipPreview } from './useSponsorshipPreview.js'
import { quoteNeedsRefresh, useAutomaticQuoteRefresh } from './useAutomaticQuoteRefresh.js'
import {
    getGasAssistFeeBreakdown,
    usdDecimalToMicros,
} from '../model/gasAssistFee.js'
import { recordWalletActivity } from '../../wallet/services/walletActivity.js'
import {
    beginOptimisticWalletTransaction,
    confirmOptimisticWalletTransaction,
    finishOptimisticWalletTransaction,
    rollbackOptimisticWalletTransaction,
} from '../../wallet/services/optimisticBalances.js'

const POST_SWAP_REFRESH_DELAYS_MS = Object.freeze([2_000, 8_000])
const OPTIMISTIC_SETTLE_DELAY_MS = 9_000

function previewReviewOrder(preview, walletAddress) {
    if (!preview) return null
    const fees = getGasAssistFeeBreakdown(preview)
    if (!fees) return null
    const micros = (value) => value?.toString() ?? '0'
    return {
        ...preview,
        id: `preview:${preview.expiresAt}`,
        isPreview: true,
        walletAddress,
        status: 'preview',
        currentRequiredAction: 'prepare-payment',
        fixedServiceFeeUsdMicros: micros(usdDecimalToMicros(preview.amountsUsd?.fixedServiceFee)),
        platformFeeUsdMicros: micros(usdDecimalToMicros(preview.amountsUsd?.platformFee)),
        commercialFeeUsdMicros: micros(fees.commercialFeeUsdMicros),
        gasReserveUsdMicros: micros(fees.networkReserveUsdMicros),
        conversionCostUsdMicros: micros(fees.conversionCostUsdMicros),
        estimatedSponsoredGasUsdMicros: micros(fees.estimatedSponsoredGasUsdMicros),
        totalPrepaymentUsdMicros: fees.totalFeeUsdMicros.toString(),
        routeCostUsdMicros: micros(fees.routeCostUsdMicros),
        allInCostUsdMicros: fees.allInCostUsdMicros?.toString() ?? fees.totalFeeUsdMicros.toString(),
    }
}

function commercialFeeRaw(preview, fees = getGasAssistFeeBreakdown(preview)) {
    try {
        if (!fees || fees.commercialFeeUsdMicros === null) return 0n
        return (
            fees.totalFeeRaw * fees.commercialFeeUsdMicros + fees.totalFeeUsdMicros - 1n
        ) / fees.totalFeeUsdMicros
    } catch {
        return 0n
    }
}

function activityAmount(raw, decimals) {
    try {
        return formatUnits(BigInt(raw), Number(decimals))
    } catch {
        return null
    }
}

function logGasAssistDiagnostic(scope, error, fallbackCode, fallbackMessage) {
    const diagnostic = {
        scope,
        code: String(error?.code ?? fallbackCode),
        message: String(error?.message ?? fallbackMessage),
    }
    if (error?.stage) diagnostic.stage = String(error.stage)
    if (error?.requestId) diagnostic.requestId = String(error.requestId)

    // Keep backend/provider codes available for advanced console debugging without
    // exposing unstable implementation details in the customer-facing status area.
    console.error('[pistachio-swap] Gas Assist diagnostic', diagnostic)
}

/**
 * Owns atomic/prepaid Gas Assist orchestration while keeping normal swap approval separate.
 * @param {object} config Gas Assist intent, feature configuration, and semantic callbacks.
 * @returns {object} Atomic Gas Assist state, active execution mode, quote/status, and dialog view models.
 * @sideEffects Calls sponsorship feature hooks; explicit confirmation may request sponsorship operations.
 * @security Low-BNB execution is fail-closed into the exact self-hosted prepaid Gas Assist flow.
 */
export function useGasAssistController({
    oneConfirmationEnabled = false,
    routingMode,
    gasAssistRoutingMode,
    normalMode,
    gasAssistExecutionMode,
    quoteEndpoint,
    account,
    sellToken,
    buyToken,
    activeAmountIn,
    activeAmountSide,
    configuredSlippageBps,
    normalQuote,
    normalQuoteStatus,
    buyInputDenomination,
    setBuyAmount,
    setVisibleStatus,
    onConfirmed,
}) {
    const refreshTimersRef = useRef(new Set())
    const optimisticHashRef = useRef(null)
    const clearRefreshTimers = useCallback(() => {
        for (const timer of refreshTimersRef.current) globalThis.clearTimeout(timer)
        refreshTimersRef.current.clear()
    }, [])

    useEffect(() => clearRefreshTimers, [account, clearRefreshTimers])

    const handleSubmittedSwap = useCallback((order) => {
        const hash = order?.swapTransactionHash ?? order?.atomicTransactionHash ?? null
        if (!hash || !account || !sellToken || !buyToken) return
        try {
            const grossInputRaw = BigInt(order?.grossInputAmountRaw ?? activeAmountIn)
            const expectedOutputRaw = BigInt(order?.expectedOutputRaw ?? 0)
            const changes = [{
                chainId: Number(sellToken?.chainId ?? 56),
                token: sellToken,
                deltaRaw: -grossInputRaw,
            }]
            if (expectedOutputRaw > 0n) {
                changes.push({
                    chainId: Number(sellToken?.chainId ?? 56),
                    token: buyToken,
                    deltaRaw: expectedOutputRaw,
                })
            }
            beginOptimisticWalletTransaction({
                walletAddress: account,
                transactionHash: hash,
                operation: 'swapping',
                changes,
            })
            optimisticHashRef.current = hash
            recordWalletActivity({
                walletAddress: account,
                chainId: Number(sellToken?.chainId ?? 56),
                type: 'swapped',
                hash,
                sellToken,
                buyToken,
                sellAmount: activityAmount(grossInputRaw, sellToken.decimals),
                buyAmount: expectedOutputRaw > 0n
                    ? activityAmount(expectedOutputRaw, buyToken.decimals)
                    : null,
                provider: 'Gas Assist',
                status: 'pending',
            })
        } catch {
            // An optimistic display update must never interfere with submission.
        }
    }, [account, activeAmountIn, buyToken, sellToken])

    const handleConfirmedSwap = useCallback(async (order) => {
        const hash = order?.swapTransactionHash ?? order?.atomicTransactionHash ?? null
        if (hash) confirmOptimisticWalletTransaction(hash)
        if (!order?.recoveredFromStorage) {
            // A reloaded page may have a different selected token pair. The
            // original transaction can be confirmed without inventing amounts
            // for that different pair.
            recordWalletActivity({
                walletAddress: account,
                chainId: Number(sellToken?.chainId ?? 56),
                type: 'swapped',
                hash,
                sellToken,
                buyToken,
                sellAmount: activityAmount(
                    order?.grossInputAmountRaw ?? activeAmountIn,
                    sellToken?.decimals,
                ),
                buyAmount: activityAmount(order?.expectedOutputRaw, buyToken?.decimals),
                provider: 'Gas Assist',
                status: 'confirmed',
            })
        }

        const refresh = async (refreshOnly) => {
            try {
                await onConfirmed?.(order, { refreshOnly })
            } catch {
                // Wallet refresh is best-effort after a transaction the backend
                // has already marked completed. Never turn settlement into failure.
            }
            setVisibleStatus?.('Gas Assist swap confirmed. Updating wallet balances…')
        }

        await refresh(false)
        for (const delay of POST_SWAP_REFRESH_DELAYS_MS) {
            const timer = globalThis.setTimeout(() => {
                refreshTimersRef.current.delete(timer)
                void refresh(true)
            }, delay)
            refreshTimersRef.current.add(timer)
        }
        if (hash) {
            const timer = globalThis.setTimeout(() => {
                refreshTimersRef.current.delete(timer)
                finishOptimisticWalletTransaction(hash)
                if (optimisticHashRef.current?.toLowerCase() === hash.toLowerCase()) {
                    optimisticHashRef.current = null
                }
            }, OPTIMISTIC_SETTLE_DELAY_MS)
            refreshTimersRef.current.add(timer)
        }
    }, [
        account,
        activeAmountIn,
        buyToken,
        onConfirmed,
        sellToken,
        setVisibleStatus,
    ])

    const gasAssistRequested = routingMode === gasAssistRoutingMode
    const prepaidSponsorship = usePrepaidSponsorship({
        oneConfirmationEnabled,
        quoteEndpoint,
        walletAddress: account,
        sellToken,
        buyToken,
        grossInputAmount: activeAmountIn,
        slippageBps: Math.max(30, configuredSlippageBps),
        required: gasAssistRequested,
        onSubmitted: handleSubmittedSwap,
        onConfirmed: handleConfirmedSwap,
    })

    useEffect(() => {
        if (!['failed', 'cancelled', 'expired', 'unsupported'].includes(prepaidSponsorship.phase)) return
        const hash = optimisticHashRef.current
        if (!hash) return
        rollbackOptimisticWalletTransaction(hash)
        recordWalletActivity({
            walletAddress: account,
            chainId: Number(sellToken?.chainId ?? 56),
            type: 'swapped',
            hash,
            sellToken,
            buyToken,
            sellAmount: activityAmount(activeAmountIn, sellToken?.decimals),
            buyAmount: null,
            provider: 'Gas Assist',
            status: 'failed',
        })
        optimisticHashRef.current = null
    }, [
        account,
        activeAmountIn,
        buyToken,
        prepaidSponsorship.phase,
        sellToken,
    ])

    const prepaidRequired = gasAssistRequested
    const prepaidEnabled = prepaidSponsorship.configStatus === 'success' &&
        prepaidSponsorship.config?.enabled === true
    const previewState = useSponsorshipPreview({
        quoteEndpoint,
        walletAddress: account,
        sellToken,
        buyToken,
        grossInputAmount: activeAmountIn,
        slippageBps: Math.max(30, configuredSlippageBps),
        required: gasAssistRequested,
        enabled: prepaidEnabled && activeAmountSide === 'sell',
    })

    const previewQuote = useMemo(() => {
        const preview = previewState.preview
        if (!prepaidEnabled || !preview || !sellToken?.address || !buyToken) return null
        const fees = getGasAssistFeeBreakdown(preview)
        if (!fees) return null
        const commercialRaw = commercialFeeRaw(preview, fees)
        return {
            prepaidSponsorshipRequired: true,
            selectedQuote: {
                chainId: Number(sellToken?.chainId ?? 56),
                mode: 'EXACT_INPUT',
                sellToken: sellToken.address,
                buyToken: buyToken.isNative ? 'native' : buyToken.address,
                sellAmount: preview.netSwapAmountRaw,
                maximumSellAmount: preview.netSwapAmountRaw,
                buyAmount: preview.expectedOutputRaw,
                minimumBuyAmount: preview.minimumOutputRaw,
                expiresAt: preview.expiresAt,
                estimatedGasUsd:
                    preview.amountsUsd?.estimatedSponsoredGas ??
                    preview.amountsUsd?.gasReserve ??
                    null,
                platformFee: {
                    amount: fees.totalFeeRaw.toString(),
                    bps: 0,
                    effectiveBps: 0,
                    token: sellToken.address,
                },
                gasAssistFee: {
                    totalAmountRaw: fees.totalFeeRaw.toString(),
                    commercialAmountRaw: commercialRaw.toString(),
                    totalUsdMicros: fees.totalFeeUsdMicros.toString(),
                    commercialUsdMicros: fees.commercialFeeUsdMicros?.toString() ?? null,
                    networkReserveUsdMicros: fees.networkReserveUsdMicros?.toString() ?? null,
                    estimatedSponsoredGasUsdMicros:
                        fees.estimatedSponsoredGasUsdMicros?.toString() ?? null,
                    routeCostUsdMicros: fees.routeCostUsdMicros?.toString() ?? null,
                    allInCostUsdMicros: fees.allInCostUsdMicros?.toString() ?? null,
                },
            },
        }
    }, [buyToken, prepaidEnabled, previewState.preview, sellToken?.address])

    const executionMode = gasAssistRequested ? gasAssistExecutionMode : normalMode
    const activeQuote = gasAssistRequested ? previewQuote : normalQuote
    const activeQuoteStatus = gasAssistRequested
        ? prepaidSponsorship.configStatus === 'idle' || prepaidSponsorship.configStatus === 'loading'
            ? 'loading'
            : !prepaidEnabled
                ? 'error'
                : activeAmountSide !== 'sell'
                    ? 'error'
                    : previewState.status
        : normalQuoteStatus
    // The swap page can display inexpensive unauthenticated estimates, but
    // the first signing review must contain the *authenticated* final order.
    // Preparing that order here avoids a second "Confirm updated quote" click.
    const refreshPrepaidQuote = useCallback(() => {
        void prepaidSponsorship.start()
        return true
    }, [prepaidSponsorship.start])

    const confirmingRef = useRef(false)
    useAutomaticQuoteRefresh({
        // Background refresh may update unsigned previews, but must not
        // trigger wallet authentication again after the final order is shown.
        enabled: oneConfirmationEnabled && gasAssistRequested && previewState.status === 'success' &&
            prepaidSponsorship.order?.isPreview === true &&
            ['idle', 'review'].includes(prepaidSponsorship.phase),
        expiresAt: previewState.preview?.expiresAt,
        onRefresh: () => {
            if (confirmingRef.current) return
            if (prepaidSponsorship.open) refreshPrepaidQuote()
            else previewState.refresh?.()
        },
    })

    const signFreshPackage = useCallback(async () => {
        if (confirmingRef.current) return
        if (oneConfirmationEnabled && prepaidSponsorship.order?.isPreview &&
            quoteNeedsRefresh(prepaidSponsorship.order.expiresAt)) {
            refreshPrepaidQuote()
            return
        }
        confirmingRef.current = true
        try { return await prepaidSponsorship.signPackage() }
        finally { confirmingRef.current = false }
    }, [oneConfirmationEnabled, prepaidSponsorship, refreshPrepaidQuote])

    const prepaidSponsorshipView = useMemo(() => ({
        ...prepaidSponsorship,
        signPackage: signFreshPackage,
        // Authenticated order creation happens before opening the final review.
        start: prepaidSponsorship.start,
        refreshQuote: refreshPrepaidQuote,
        refreshing: prepaidSponsorship.phase === 'preview-loading' && previewState.status === 'loading',
    }), [
        prepaidSponsorship,
        previewState.status,
        refreshPrepaidQuote,
        signFreshPackage,
    ])

    useEffect(() => {
        if (!gasAssistRequested || activeAmountSide !== 'sell' || buyInputDenomination !== 'TOKEN') return
        if (previewState.status !== 'success' || !previewState.preview || !buyToken) {
            if (previewState.status === 'loading' || previewState.status === 'error') setBuyAmount('0')
            return
        }
        try {
            setBuyAmount(formatUnits(
                BigInt(previewState.preview.expectedOutputRaw),
                Number(buyToken.decimals),
            ))
        } catch {
            setBuyAmount('0')
        }
    }, [
        activeAmountSide,
        buyInputDenomination,
        buyToken,
        gasAssistRequested,
        previewState.preview,
        previewState.status,
        setBuyAmount,
    ])

    useEffect(() => {
        if (!gasAssistRequested) return
        if (prepaidSponsorship.configStatus === 'idle' || prepaidSponsorship.configStatus === 'loading') return
        if (prepaidEnabled) return
        logGasAssistDiagnostic(
            'configuration',
            prepaidSponsorship.configError,
            'SPONSORSHIP_UNAVAILABLE',
            'Exact prepaid Gas Assist is disabled or unavailable.',
        )
    }, [
        gasAssistRequested,
        prepaidEnabled,
        prepaidSponsorship.configError,
        prepaidSponsorship.configStatus,
    ])

    useEffect(() => {
        if (!gasAssistRequested || !prepaidEnabled || activeAmountSide !== 'sell') return
        if (previewState.status !== 'error') return
        logGasAssistDiagnostic(
            'preview',
            previewState.error,
            'SPONSORSHIP_PREVIEW_UNAVAILABLE',
            'Gas Assist could not preview this swap.',
        )
    }, [
        activeAmountSide,
        gasAssistRequested,
        prepaidEnabled,
        previewState.error,
        previewState.status,
    ])

    return {
        prepaidSponsorship: prepaidSponsorshipView,
        prepaidRequired,
        preview: prepaidEnabled ? previewState.preview : null,
        previewStatus: prepaidEnabled ? previewState.status : 'idle',
        previewError: prepaidEnabled ? previewState.error : null,
        executionMode,
        activeQuote,
        activeQuoteStatus,
    }
}

export const gasAssistControllerInternals = {
    activityAmount,
    commercialFeeRaw,
    logGasAssistDiagnostic,
    previewReviewOrder,
    usdMicros: usdDecimalToMicros,
}
