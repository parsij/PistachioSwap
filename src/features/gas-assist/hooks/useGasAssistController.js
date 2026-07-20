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
    const prepaidRequired = routingMode === gasAssistRoutingMode && gasAssist.quoteStatus === 'error' &&
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
    const quoteReady = gasAssist.quoteStatus === 'success' && gasAssist.quote !== null
    const executionMode = routingMode === gasAssistRoutingMode &&
        (quoteReady || (prepaidRequired && prepaidSponsorship.config?.enabled))
        ? gaslessMode
        : normalMode
    const activeQuote = executionMode === gaslessMode
        ? prepaidRequired && prepaidSponsorship.config?.enabled
            ? { prepaidSponsorshipRequired: true }
            : gasAssist.quote
        : normalQuote
    const activeQuoteStatus = executionMode === gaslessMode
        ? prepaidRequired && prepaidSponsorship.config?.enabled
            ? 'success'
            : gasAssist.quoteStatus
        : normalQuoteStatus

    useEffect(() => {
        if (activeAmountSide !== 'sell' || executionMode !== gaslessMode || !gasAssist.quote?.buyAmount || !buyToken) return
        if (buyInputDenomination === 'TOKEN') {
            setBuyAmount(formatUnits(BigInt(gasAssist.quote.buyAmount), Number(buyToken.decimals ?? 18)))
        }
    }, [activeAmountSide, buyInputDenomination, buyToken, executionMode, gasAssist.quote, gaslessMode, setBuyAmount])

    useEffect(() => {
        if (routingMode !== gasAssistRoutingMode || gasAssist.quoteStatus !== 'error' ||
            (prepaidRequired && prepaidSponsorship.config?.enabled) || normalQuoteStatus === 'success') return
        const code = gasAssist.quoteError?.code
        const message = gasAssist.quoteError?.message ?? 'Gas Assist could not provide a quote.'
        setVisibleStatus(code ? `${code}: ${message}` : message)
    }, [
        gasAssist.quoteError,
        gasAssist.quoteStatus,
        gasAssistRoutingMode,
        normalQuoteStatus,
        prepaidRequired,
        prepaidSponsorship.config?.enabled,
        routingMode,
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
