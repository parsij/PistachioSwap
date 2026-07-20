import { isAddress } from 'viem'

import { getValidatedExecutableTransaction } from './executableTransaction.js'

const sameAddress = (left, right) => String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase()

/** Typed safe error for a refreshed response that changed reviewed intent. */
export class RefreshedQuoteValidationError extends Error {
    constructor(message) {
        super(message)
        this.name = 'RefreshedQuoteValidationError'
    }
}

/**
 * Purpose: proves a force-refreshed quote still represents the confirmed swap.
 * Inputs: refreshed and previous quote responses, captured request snapshot,
 * connected account/chain/token identities, and Permit2/schema requirements.
 * Output: the same refreshed quote after complete validation.
 * Side effects: none.
 * Errors: throws `RefreshedQuoteValidationError` for stale account, chain,
 * tokens, amount, provider, schema, approval binding, target, or expiry.
 * Security: never adapts changed intent; canonical approval metadata and the
 * executable transaction remain bound to the captured review request.
 */
export function validateRefreshedQuote({
    refreshedQuote,
    previousQuote,
    snapshot,
    account,
    chainId,
    sellToken,
    buyToken,
    requirePancakePermit2 = false,
    mismatchMessage = 'The refreshed quote no longer matches the approved swap.',
}) {
    const fail = (message = mismatchMessage) => { throw new RefreshedQuoteValidationError(message) }
    const request = snapshot?.request
    const selected = refreshedQuote?.selectedQuote
    const previous = previousQuote?.selectedQuote
    if (!request || !snapshot?.requestKey || !selected) fail()
    if (!sameAddress(request.takerAddress, account)) fail('The refreshed quote no longer matches the connected wallet.')
    if (Number(request.chainId) !== Number(chainId) || Number(selected.chainId) !== Number(chainId)) fail()
    if (!sameAddress(request.sellToken, sellToken) || !sameAddress(selected.sellToken, sellToken) || !sameAddress(request.buyToken, buyToken) || !sameAddress(selected.buyToken, buyToken)) fail()
    if (selected.mode !== request.mode) fail()
    if (request.mode === 'EXACT_INPUT' && String(selected.sellAmount ?? '') !== String(request.sellAmount ?? '')) fail()
    if (request.mode === 'EXACT_OUTPUT' && String(selected.buyAmount ?? '') !== String(request.buyAmount ?? '')) fail()
    if (Number(snapshot.slippageBps) !== Number(request.slippageBps)) fail()
    if (String(selected.provider ?? '').trim().toLowerCase() !== String(previous?.provider ?? '').trim().toLowerCase()) fail()

    const pancake = requirePancakePermit2 || String(selected.provider ?? '').trim().toLowerCase() === 'pancakeswap'
    if (pancake) {
        const approval = selected.approval
        const oldApproval = previous?.approval
        const requiredIntentAmount = request.mode === 'EXACT_INPUT' ? request.sellAmount : selected.maximumSellAmount
        const validRequiredAmount = /^[1-9]\d*$/.test(String(approval?.requiredAmount ?? '')) && /^[1-9]\d*$/.test(String(requiredIntentAmount ?? '')) && BigInt(approval.requiredAmount) >= BigInt(requiredIntentAmount)
        if (refreshedQuote.approvalSchemaVersion !== 1 || approval?.mode !== 'permit2-allowance' || !isAddress(approval.contract ?? '') || !isAddress(approval.spender ?? '') || !isAddress(approval.token ?? '') || !validRequiredAmount || !sameAddress(approval.contract, selected.allowanceTarget) || !sameAddress(approval.spender, selected.transaction?.to) || !sameAddress(approval.token, selected.sellToken) || !sameAddress(approval.contract, oldApproval?.contract) || !sameAddress(approval.spender, oldApproval?.spender) || !sameAddress(approval.token, oldApproval?.token)) {
            fail('The refreshed PancakeSwap quote changed its Permit2 authorization.')
        }
    }
    getValidatedExecutableTransaction({ quoteResponse: refreshedQuote, expectedChainId: chainId, expectedSellToken: sellToken, expectedBuyToken: buyToken, expectedAccount: account })
    return refreshedQuote
}
