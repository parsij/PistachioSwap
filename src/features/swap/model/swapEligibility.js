import { parseEther } from 'viem'
import {
    DEFAULT_NATIVE_GAS_RESERVE_WEI,
    getNativeSpendableWei,
    getTokenBalanceWei,
    isNativeEvmToken,
} from '../../../services/balances.js'
import { getSwapActionState } from '../../../services/swapAction.js'
import { deriveSameChainReviewEligibility } from './sameChainReviewEligibility.js'
import { compareDecimalStrings, decimalRatioBps, multiplyUnitsByDecimal } from './amountMath.js'

/**
 * Derives funds, economic viability, same-chain review eligibility, and the primary CTA without side effects.
 * @param {object} input Current wallet, intent, quote, routing, settings, and balance values.
 * @returns {object} `action`, `insufficientFunds`, `economicViability`, `reviewEligibility`, and balance-check amount.
 * @security Review eligibility remains fail-closed for stale quote identity and incomplete approval metadata.
 */
export function deriveSwapEligibility(input) {
    const {
        walletState, walletAddress, sellToken, buyToken, activeAmountSide, activeAmountIn, activeBuyAmountIn,
        sellAmount, sellDisplayPrice, buyDisplayPrice, routingMode, crossChainMode, gaslessMode, executionMode,
        quote, activeQuote, activeQuoteStatus, currentCrossChainRoute, crossChainRouteExpired,
        crossChainExactOutputUnsupported, transactionStatus, nativeBalanceValue, nativeGasReserve,
        maxCostToInputBps, swapChainId, sellChainId, buyChainId, quoteSnapshot, quoteInputKey,
        prepaidRequired, prepaidEnabled,
    } = input
    const hasActiveAmount = activeAmountSide === 'buy'
        ? Boolean(input.buyAmount) && activeBuyAmountIn !== null && activeBuyAmountIn !== '0'
        : Boolean(sellAmount) && activeAmountIn !== null && activeAmountIn !== '0'
    const sellAmountForBalanceCheck = routingMode === crossChainMode
        ? activeAmountIn
        : activeAmountSide === 'buy'
            ? quote?.selectedQuote?.maximumSellAmount ?? quote?.selectedQuote?.sellAmount ?? activeAmountIn
            : activeAmountIn
    let sourceSpendableBalance = 0n
    if (sellToken) {
        if (isNativeEvmToken(sellToken)) {
            let reserve = DEFAULT_NATIVE_GAS_RESERVE_WEI
            try {
                reserve = parseEther(nativeGasReserve)
            } catch {
                reserve = DEFAULT_NATIVE_GAS_RESERVE_WEI
            }
            sourceSpendableBalance = getNativeSpendableWei({ balanceWei: nativeBalanceValue ?? 0n, fallbackReserveWei: reserve })
        } else {
            sourceSpendableBalance = getTokenBalanceWei(sellToken)
        }
    }
    const insufficientFunds = Boolean(walletState.isConnected && sellToken && hasActiveAmount &&
        sellAmountForBalanceCheck && /^\d+$/.test(String(sellAmountForBalanceCheck)) &&
        BigInt(sellAmountForBalanceCheck) > sourceSpendableBalance)
    const inputValueUsd = activeAmountIn && sellToken
        ? multiplyUnitsByDecimal(activeAmountIn, Number(sellToken.decimals ?? 18), sellDisplayPrice)
        : null
    const outputRawAmount = routingMode === crossChainMode
        ? currentCrossChainRoute?.outputAmount
        : activeQuote?.selectedQuote?.buyAmount
    const outputValueUsd = outputRawAmount && buyToken
        ? multiplyUnitsByDecimal(outputRawAmount, Number(buyToken.decimals ?? 18), buyDisplayPrice)
        : null
    const sourceGasUsd = routingMode === crossChainMode ? null : activeQuote?.selectedQuote?.estimatedGasUsd ?? null
    const totalKnownCostsUsd = sourceGasUsd
    const costToInputRatio = inputValueUsd && totalKnownCostsUsd
        ? decimalRatioBps(totalKnownCostsUsd, inputValueUsd)
        : null
    const reasons = []
    if (outputValueUsd && totalKnownCostsUsd && compareDecimalStrings(totalKnownCostsUsd, outputValueUsd) >= 0) {
        reasons.push('costs-exceed-output')
    }
    const warnings = []
    if (Number.isFinite(costToInputRatio) && Number.isFinite(maxCostToInputBps) && costToInputRatio > maxCostToInputBps) {
        warnings.push('cost-ratio')
    }
    const economicViability = {
        viable: reasons.length === 0,
        inputValueUsd,
        outputValueUsd,
        sourceGasUsd,
        totalKnownCostsUsd,
        costToInputRatio,
        reasons,
        warnings,
    }
    const economicallyInvalid = Boolean(hasActiveAmount && activeQuoteStatus === 'success' && !economicViability.viable)
    const reviewEligibility = routingMode !== crossChainMode && executionMode !== gaslessMode
        ? deriveSameChainReviewEligibility({
            activeAmountIn,
            activeBuyAmountIn,
            activeAmountSide,
            activeQuote: quote,
            activeQuoteStatus,
            buyChainId,
            buyToken,
            currentInputKey: quoteSnapshot?.inputKey ?? null,
            insufficientFunds,
            quote,
            quoteInputKey,
            sellAmountForBalanceCheck,
            sellChainId,
            sellToken,
            swapChainId,
            walletAddress,
            walletState: { isConnected: walletState.isConnected, isCorrectNetwork: walletState.isCorrectNetwork },
        })
        : { canReview: true, blockingReason: null, blockingMessage: null }
    const baseAction = getSwapActionState({
        isConnected: walletState.isConnected,
        isCorrectNetwork: walletState.isCorrectNetwork,
        hasSellToken: Boolean(sellToken),
        hasBuyToken: Boolean(buyToken),
        hasAmount: hasActiveAmount,
        quoteStatus: activeQuoteStatus,
        quoteReady: activeQuoteStatus === 'success' && activeQuote !== null,
        transactionStatus,
    })
    if (baseAction.type === 'switch-network') baseAction.label = `Switch to ${input.activeChainName ?? 'token network'}`
    let action = prepaidRequired && prepaidEnabled && baseAction.type === 'swap'
        ? { ...baseAction, label: 'Review Gas Assist prepayment' }
        : baseAction
    if (baseAction.type === 'swap') action = { ...action, label: 'Review swap' }
    if (baseAction.type === 'swap' && routingMode !== crossChainMode && executionMode !== gaslessMode && !reviewEligibility.canReview) {
        action = { type: `review-blocked:${reviewEligibility.blockingReason}`, label: reviewEligibility.blockingMessage, enabled: true }
    }
    if (routingMode === crossChainMode && activeQuoteStatus === 'loading') {
        action = { type: 'quote-loading', label: 'Finding cross-chain route…', enabled: false }
    }
    if (routingMode === crossChainMode && crossChainRouteExpired) {
        action = { type: 'refresh-quote', label: 'Refresh quote', enabled: true }
    }
    if (!['connect', 'select-token', 'enter-amount'].includes(baseAction.type) && insufficientFunds) {
        action = { type: 'insufficient-funds', label: `Not enough ${sellToken?.symbol ?? 'funds'}`, enabled: false }
    }
    if (crossChainExactOutputUnsupported && !insufficientFunds) {
        action = { type: 'exact-output-unsupported', label: 'Exact output is not supported for this route.', enabled: false }
    }
    if (economicallyInvalid && !insufficientFunds) {
        action = { type: 'economically-invalid', label: 'Estimated costs are too high for this amount.', enabled: false }
    }
    return { action, reviewEligibility, insufficientFunds, economicViability, economicallyInvalid, sellAmountForBalanceCheck }
}
