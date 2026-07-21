import { useEffect } from 'react'
import { useZeroXGaslessSwap } from './useZeroXGaslessSwap.js'
import { usePrepaidSponsorship } from './usePrepaidSponsorship.js'

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

    const prepaidRequired = gasAssistRequested
    const prepaidEnabled = prepaidSponsorship.configStatus === 'success' &&
        prepaidSponsorship.config?.enabled === true
    const executionMode = gasAssistRequested ? gaslessMode : normalMode
    const activeQuote = gasAssistRequested
        ? prepaidEnabled ? { prepaidSponsorshipRequired: true } : null
        : normalQuote
    const activeQuoteStatus = gasAssistRequested
        ? prepaidSponsorship.configStatus === 'idle' || prepaidSponsorship.configStatus === 'loading'
            ? 'loading'
            : prepaidEnabled ? 'success' : 'error'
        : normalQuoteStatus

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

    return {
        gasAssist,
        prepaidSponsorship,
        prepaidRequired,
        executionMode,
        activeQuote,
        activeQuoteStatus,
        isGasless: executionMode === gaslessMode,
    }
}
