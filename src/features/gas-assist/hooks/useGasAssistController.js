import { useEffect, useMemo } from 'react'
import { formatUnits } from 'viem'
import { useZeroXGaslessSwap } from './useZeroXGaslessSwap.js'
import { usePrepaidSponsorship } from './usePrepaidSponsorship.js'
import { useSponsorshipPreview } from './useSponsorshipPreview.js'

/**
 * Owns Gas Assist quote/dialog/prepayment orchestration while keeping normal swap approval separate.
 * @param {object} config Gas Assist intent, feature configuration, and semantic callbacks.
 * @returns {object} Gas Assist hooks, active execution mode, quote/status, and dialog view models.
 * @sideEffects Calls existing Gas Assist backend hooks; explicit dialog confirmation may request sponsorship operations.
 * @security Low-BNB execution is fail-closed into the exact prepaid flow and never falls back to a normal approval quote.
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
    sellChainId,
    buyChainId,
    activeAmountIn,
    activeAmountSide,
    configuredSlippageBps,
    gasAssistConfig,
    refreshIndex,
    normalQuote,
    normalQuoteStatus,
    buyInputDenomination,
    setBuyAmount,
    setVisibleStatus,
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

    // Keep the old 0x Gasless dialog hook mounted for API compatibility, but never
    // ask the provider-integrator endpoint to price a low-BNB wallet. The exact
    // prepaid order service owns payment, approval, and swap sponsorship.
    const gasAssist = useZeroXGaslessSwap({
        quoteEndpoint,
        walletAddress: account,
        sellToken,
        buyToken,
        sourceChainId: sellChainId,
        destinationChainId: buyChainId,
        sellAmount: activeAmountIn,
        slippageBps: Math.max(30, configuredSlippageBps),
        config: gasAssistConfig.config,
        quoteEnabled: false,
        refreshIndex,
        onConfirmed,
    })

    const previewQuote = useMemo(() => {
        const preview = previewState.preview
        if (!preview || !sellToken?.address || !buyToken) return null
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
                estimatedGasUsd: preview.amountsUsd?.estimatedSwapGas ?? null,
                platformFee: {
                    amount: '0',
                    bps: 0,
                    effectiveBps: 0,
                    token: sellToken.address,
                },
            },
        }
    }, [buyToken, previewState.preview, sellToken?.address])

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
        const code = prepaidSponsorship.configError?.code ?? 'SPONSORSHIP_UNAVAILABLE'
        const message = prepaidSponsorship.configError?.message ??
            'Exact prepaid Gas Assist is disabled or unavailable.'
        setVisibleStatus(`${code}: ${message}`)
    }, [
        gasAssistRequested,
        prepaidEnabled,
        prepaidSponsorship.configError,
        prepaidSponsorship.configStatus,
        setVisibleStatus,
    ])

    useEffect(() => {
        if (!gasAssistRequested || !prepaidEnabled || activeAmountSide !== 'sell') return
        if (previewState.status !== 'error') return
        const code = previewState.error?.code ?? 'SPONSORSHIP_PREVIEW_UNAVAILABLE'
        const message = previewState.error?.message ??
            'Gas Assist could not preview this swap.'
        setVisibleStatus(`${code}: ${message}`)
    }, [
        activeAmountSide,
        gasAssistRequested,
        prepaidEnabled,
        previewState.error,
        previewState.status,
        setVisibleStatus,
    ])

    return {
        gasAssist,
        prepaidSponsorship,
        prepaidRequired,
        preview: previewState.preview,
        previewStatus: previewState.status,
        previewError: previewState.error,
        executionMode,
        activeQuote,
        activeQuoteStatus,
        isGasless: executionMode === gaslessMode,
    }
}
