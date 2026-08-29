import { useEffect, useMemo } from 'react'
import { formatUnits } from 'viem'
import { usePrepaidSponsorship } from './usePrepaidSponsorship.js'
import { useSponsorshipPreview } from './useSponsorshipPreview.js'

function usdMicros(value) {
    const normalized = String(value ?? '').trim()
    if (!/^\d+(?:\.\d+)?$/u.test(normalized)) return null
    const [whole, fraction = ''] = normalized.split('.')
    if (fraction.length > 6) return null
    return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0') || '0')
}

function previewReviewOrder(preview, walletAddress) {
    if (!preview) return null
    const micros = (value) => usdMicros(value)?.toString() ?? '0'
    return {
        ...preview,
        id: `preview:${preview.expiresAt}`,
        isPreview: true,
        walletAddress,
        status: 'preview',
        currentRequiredAction: 'prepare-payment',
        fixedServiceFeeUsdMicros: micros(preview.amountsUsd?.fixedServiceFee),
        platformFeeUsdMicros: micros(preview.amountsUsd?.platformFee),
        gasReserveUsdMicros: micros(preview.amountsUsd?.gasReserve),
        totalPrepaymentUsdMicros: micros(preview.amountsUsd?.totalPrepayment),
    }
}

function commercialFeeRaw(preview) {
    try {
        const totalRaw = BigInt(preview.paymentAmountRaw)
        const commercialUsd = usdMicros(preview.amountsUsd?.commercialFee)
        const totalUsd = usdMicros(preview.amountsUsd?.totalPrepayment)
        if (commercialUsd === null || totalUsd === null || totalUsd <= 0n) return 0n
        return (totalRaw * commercialUsd + totalUsd - 1n) / totalUsd
    } catch {
        return 0n
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
    onConfirmed,
}) {
    const gasAssistRequested = routingMode === gasAssistRoutingMode
    const prepaidSponsorship = usePrepaidSponsorship({
        quoteEndpoint,
        walletAddress: account,
        sellToken,
        buyToken,
        grossInputAmount: activeAmountIn,
        slippageBps: Math.max(30, configuredSlippageBps),
        required: gasAssistRequested,
        onConfirmed,
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
        const commercialRaw = commercialFeeRaw(preview)
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
                estimatedGasUsd: preview.amountsUsd?.gasReserve ?? null,
                platformFee: {
                    amount: commercialRaw.toString(),
                    bps: 0,
                    effectiveBps: 0,
                    token: sellToken.address,
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
    commercialFeeRaw,
    logGasAssistDiagnostic,
    previewReviewOrder,
    usdMicros,
}
