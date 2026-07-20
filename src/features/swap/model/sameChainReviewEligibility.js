import { isAddress } from 'viem'

import { getExecutableTransaction, isQuoteExpired } from '../../../services/swapTransaction.js'

/**
 * Purpose: decides whether the current same-chain quote may be shown for review.
 * Inputs: one object containing wallet state, selected tokens/chains, raw input
 * identity, quote state, balance result, and expected execution chain.
 * Output: `{ canReview, blockingReason, blockingMessage, visibleMessage, actionType }`.
 * Side effects: none. Errors: malformed executable quote data becomes a blocked result.
 * Security: verifies canonical Pancake Permit2 metadata and transaction binding
 * before the UI permits a wallet operation.
 */
export function deriveSameChainReviewEligibility({
    activeAmountIn, activeBuyAmountIn, activeAmountSide, activeQuote,
    activeQuoteStatus, buyChainId, buyToken, currentInputKey, insufficientFunds,
    quote, quoteInputKey, sellAmountForBalanceCheck, sellChainId, sellToken,
    swapChainId, walletAddress, walletState,
}) {
    const blocked = (blockingReason, visibleMessage, actionType = 'review-blocked') => ({
        canReview: false,
        blockingReason,
        blockingMessage: visibleMessage,
        visibleMessage,
        actionType,
    })
    if (!walletState.isConnected || !walletAddress) return blocked('wallet-disconnected', 'Connect wallet to continue.', 'connect')
    if (!walletState.isCorrectNetwork) return blocked('wrong-chain', 'Switch to the selected network to continue.', 'switch-network')
    if (!sellToken || !buyToken) return blocked('wrong-token', 'Select both tokens to continue.')
    if (sellChainId !== swapChainId || buyChainId !== swapChainId) return blocked('wrong-chain', 'The selected route no longer matches the source network.')
    if (activeQuoteStatus !== 'success' || !activeQuote || !quote?.selectedQuote) return blocked('quote-missing', 'Quote is not ready. Refresh the quote and try again.')
    if (isQuoteExpired(quote)) return blocked('quote-expired', 'The quote expired. Refresh the quote.', 'refresh-quote')
    if (!currentInputKey || quoteInputKey !== currentInputKey) return blocked('stale-quote', 'Quote no longer matches the selected tokens and amount.')
    if (!sellAmountForBalanceCheck || !/^\d+$/.test(String(sellAmountForBalanceCheck))) return blocked('stale-quote', 'Quote no longer matches the selected amount.')
    if (activeAmountSide === 'sell' && String(quote.selectedQuote.sellAmount ?? activeAmountIn ?? '') !== String(activeAmountIn ?? '')) return blocked('stale-quote', 'Quote no longer matches the selected amount.')
    if (activeAmountSide === 'buy' && quote.selectedQuote.buyAmount && activeBuyAmountIn && String(quote.selectedQuote.buyAmount) !== String(activeBuyAmountIn)) return blocked('stale-quote', 'Quote no longer matches the selected amount.')
    if (insufficientFunds) return blocked('insufficient-balance', `Not enough ${sellToken?.symbol ?? 'funds'} for this swap.`)
    const selected = quote.selectedQuote
    const provider = String(selected.provider ?? '').trim().toLowerCase()
    if (provider !== 'pancakeswap' && selected.approval && !['permit2-allowance', 'erc20'].includes(selected.approval.mode)) return blocked('unsupported-approval-mode', 'This quote uses an unsupported approval mode.')
    if (provider === 'pancakeswap' && !sellToken?.isNative) {
        const approval = selected.approval
        const requiredAmount = selected.mode === 'EXACT_OUTPUT' ? selected.maximumSellAmount : selected.sellAmount
        const validAmount = /^[1-9]\d*$/.test(String(approval?.requiredAmount ?? '')) && /^[1-9]\d*$/.test(String(requiredAmount ?? '')) && BigInt(approval.requiredAmount) >= BigInt(requiredAmount)
        if (approval?.mode !== 'permit2-allowance' || !isAddress(approval.contract ?? '') || !isAddress(approval.spender ?? '') || !isAddress(approval.token ?? '') || String(approval.contract).toLowerCase() !== String(selected.allowanceTarget ?? '').toLowerCase() || String(approval.spender).toLowerCase() !== String(selected.transaction?.to ?? '').toLowerCase() || String(approval.token).toLowerCase() !== String(selected.sellToken ?? '').toLowerCase() || !validAmount) return blocked('missing-permit2-approval-metadata', 'PancakeSwap approval information is incomplete. Refresh the quote.')
    }
    try {
        getExecutableTransaction(quote, { chainId: swapChainId, sellToken: sellToken.address, buyToken: buyToken.address })
    } catch (error) {
        return blocked('malformed-executable-transaction', error instanceof Error ? error.message : 'The provider quote is no longer executable.')
    }
    return { canReview: true, blockingReason: null, blockingMessage: null, visibleMessage: null, actionType: 'swap' }
}
