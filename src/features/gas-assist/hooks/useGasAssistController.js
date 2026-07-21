import { useEffect } from 'react'
import { formatUnits } from 'viem'
import { useZeroXGaslessSwap } from './useZeroXGaslessSwap.js'
import { usePrepaidSponsorship } from './usePrepaidSponsorship.js'

/**
 * Owns Gas Assist quote/dialog/prepayment orchestration while keeping normal swap approval separate.
 * @param {object} config Gas Assist intent, feature configuration, and semantic callbacks.
 * @returns {object} Gas Assist hooks, active execution mode, quote/status, and dialog view models.
 * @sideEffects Calls existing Gas Assist backend hooks; explicit dialog confirmation may request gasless signatures or sponsorship operations.
 * @security Activates only for the supplied Gas Assist routing mode and preserves backend-authoritative configuration.
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
        quoteEnabled: routingMode === gasAssistRoutingMode && activeAmountSide === 'sell',
        refreshIndex,
        onConfirmed,
    })
    const gasAssistRequested = routingMode === gasAssistRoutingMode
    const prepaidRequired = gasAssistRequested && gasAssist.quoteStatus === 'error' &&
        gasAssist.quoteError?.code === 'ONCHAIN_APPROVAL_REQUIRED'
    const prepaidSponsorship = usePrepaidSponsorship({
        quoteEndpoint,
        walletAddress: account,
        sellToken,
        buyToken,
        grossInputAmount: activeAmountIn,
        slippageBps: Math.max(30, configuredSlippageBps),
        required: prepaidRequired,
        onConfirmed,
    })
    const prepaidEnabled = prepaidRequired && prepaidSponsorship.config?.enabled === true
    const executionMode = gasAssistRequested ? gaslessMode : normalMode
    const activeQuote = gasAssistRequested
        ? prepaidEnabled
            ? { prepaidSponsorshipRequired: true }
            : gasAssist.quote
        : normalQuote
    const activeQuoteStatus = gasAssistRequested
        ? prepaidRequired
            ? prepaidSponsorship.configStatus === 'success'
                ? prepaidEnabled ? 'success' : 'error'
                : prepaidSponsorship.configStatus === 'error' ? 'error' : 'loading'
            : gasAssist.quoteStatus
        : normalQuoteStatus

    useEffect(() => {
        if (activeAmountSide !== 'sell' || executionMode !== gaslessMode || !gasAssist.quote?.buyAmount || !buyToken) return
        if (buyInputDenomination === 'TOKEN') {
            setBuyAmount(formatUnits(BigInt(gasAssist.quote.buyAmount), Number(buyToken.decimals ?? 18)))
        }
    }, [activeAmountSide, buyInputDenomination, buyToken, executionMode, gasAssist.quote, gaslessMode, setBuyAmount])

    useEffect(() => {
        if (!gasAssistRequested || gasAssist.quoteStatus !== 'error') return
        if (prepaidRequired) {
            if (prepaidSponsorship.configStatus === 'idle' || prepaidSponsorship.configStatus === 'loading') return
            if (prepaidSponsorship.config?.enabled) return
            const code = prepaidSponsorship.configError?.code ?? 'SPONSORSHIP_UNAVAILABLE'
            const message = prepaidSponsorship.configError?.message ?? 'Prepaid Gas Assist sponsorship is unavailable.'
            setVisibleStatus(`${code}: ${message}`)
            return
        }
        const code = gasAssist.quoteError?.code
        const message = gasAssist.quoteError?.message ?? 'Gas Assist could not provide a quote.'
        setVisibleStatus(code ? `${code}: ${message}` : message)
    }, [
        gasAssist.quoteError,
        gasAssist.quoteStatus,
        gasAssistRequested,
        prepaidRequired,
        prepaidSponsorship.config?.enabled,
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
