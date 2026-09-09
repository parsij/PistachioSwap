import { useCallback, useEffect, useMemo, useRef } from 'react'
import { formatUnits } from 'viem'
import { usePrepaidSponsorship } from './usePrepaidSponsorship.js'
import { useSponsorshipPreview } from './useSponsorshipPreview.js'
import {
    getGasAssistFeeBreakdown,
    usdDecimalToMicros,
} from '../model/gasAssistFee.js'
import { recordWalletActivity } from '../../wallet/services/walletActivity.js'

const POST_SWAP_REFRESH_DELAYS_MS = Object.freeze([2_000, 8_000])

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

function removedLegacyGaslessState(quoteStatus) {
    const removed = () => {
        throw new Error('Legacy 0x Gasless execution has been removed. Use atomic Gas Assist.')
    }
    return Object.freeze({
        quote: null,
        quoteStatus,
        quoteError: null,
        available: false,
        dialog: Object.freeze({ open: false, state: 'removed' }),
        open: removed,
        close: () => undefined,
        confirm: removed,
    })
}

/**
 * Owns atomic/prepaid Gas Assist orchestration while keeping normal swap approval separate.
 * @param {object} config Gas Assist intent, feature configuration, and semantic callbacks.
 * @returns {object} Atomic Gas Assist state, active execution mode, quote/status, and dialog view models.
 * @sideEffects Calls sponsorship feature hooks; explicit confirmation may request sponsorship operations.
 * @security Low-BNB execution is fail-closed into the exact atomic prepaid flow and never falls back to retired 0x Gasless execution.
 */
export function useGasAssistController({
    routingMode,
    gasAssistRoutingMode,
    normalMode,
    gaslessMode,
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
    const clearRefreshTimers = useCallback(() => {
        for (const timer of refreshTimersRef.current) globalThis.clearTimeout(timer)
        refreshTimersRef.current.clear()
    }, [])

    useEffect(() => clearRefreshTimers, [account, clearRefreshTimers])

    const handleConfirmedSwap = useCallback(async (order) => {
        const hash = order?.swapTransactionHash ?? order?.atomicTransactionHash ?? null
        recordWalletActivity({
            walletAddress: account,
            chainId: 56,
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
        })

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
        quoteEndpoint,
        walletAddress: account,
        sellToken,
        buyToken,
        grossInputAmount: activeAmountIn,
        slippageBps: Math.max(30, configuredSlippageBps),
        required: gasAssistRequested,
        onConfirmed: handleConfirmedSwap,
    })

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
                chainId: 56,
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

    const executionMode = gasAssistRequested ? gaslessMode : normalMode
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
    const compatibilityGasAssist = useMemo(
        () => removedLegacyGaslessState(gasAssistRequested ? activeQuoteStatus : 'idle'),
        [activeQuoteStatus, gasAssistRequested],
    )
    const reviewPreview = useMemo(
        () => previewReviewOrder(previewState.preview, account),
        [account, previewState.preview],
    )
    const prepaidSponsorshipView = useMemo(() => ({
        ...prepaidSponsorship,
        start: reviewPreview
            ? () => prepaidSponsorship.reviewOrder(reviewPreview)
            : prepaidSponsorship.start,
    }), [prepaidSponsorship, reviewPreview])

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
        // Retained only as a fail-closed shape for older view-model callers. No
        // 0x Gasless network, signing, submission, or polling logic remains.
        gasAssist: compatibilityGasAssist,
        prepaidSponsorship: prepaidSponsorshipView,
        prepaidRequired,
        preview: prepaidEnabled ? previewState.preview : null,
        previewStatus: prepaidEnabled ? previewState.status : 'idle',
        previewError: prepaidEnabled ? previewState.error : null,
        executionMode,
        activeQuote,
        activeQuoteStatus,
        isGasless: executionMode === gaslessMode,
    }
}

export const gasAssistControllerInternals = {
    activityAmount,
    commercialFeeRaw,
    logGasAssistDiagnostic,
    previewReviewOrder,
    usdMicros: usdDecimalToMicros,
}
