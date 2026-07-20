import { isAddress, isHex } from 'viem'

function parseQuantity(value, fieldName) {
    if (!/^(0|[1-9]\d*)$/.test(String(value ?? ''))) {
        throw new Error(`The quote contains an invalid transaction ${fieldName}.`)
    }
    return BigInt(value)
}

/**
 * Purpose: validates a selected quote and returns the exact transaction request
 * that may be simulated and submitted.
 * Inputs: quote response, expected chain, sell/buy token addresses, optional
 * connected account, and optional current time.
 * Output: normalized `{ to, data, value, chainId, gas? }` transaction object.
 * Side effects: none; this function never calls an RPC or wallet.
 * Errors: throws the existing safe quote/transaction mismatch messages for an
 * expired quote, invalid target/calldata/quantities, or wrong chain/tokens.
 * Security: the returned request is bound to the reviewed chain and token pair;
 * account is validated when the quote exposes a taker/account field.
 */
export function getValidatedExecutableTransaction({
    quoteResponse,
    expectedChainId,
    expectedSellToken,
    expectedBuyToken,
    expectedAccount = null,
    now = Date.now(),
    requireUnexpired = true,
}) {
    const quote = quoteResponse?.selectedQuote
    const transaction = quote?.transaction
    const expiresAt = Date.parse(quote?.expiresAt ?? '')
    if (requireUnexpired && (!Number.isFinite(expiresAt) || expiresAt <= now)) {
        throw new Error('The quote expired. Refresh the quote.')
    }
    if (!transaction || !isAddress(transaction.to ?? '')) {
        throw new Error('The quote does not contain a valid destination address.')
    }
    const chainId = Number(expectedChainId)
    if (!Number.isSafeInteger(chainId) || chainId <= 0 || Number(quote?.chainId) !== chainId || String(quote?.sellToken ?? '').toLowerCase() !== String(expectedSellToken ?? '').toLowerCase() || String(quote?.buyToken ?? '').toLowerCase() !== String(expectedBuyToken ?? '').toLowerCase()) {
        throw new Error('The quote no longer matches the selected chain and tokens.')
    }
    const quoteAccount = quote?.takerAddress ?? quote?.account ?? null
    if (quoteAccount && expectedAccount && String(quoteAccount).toLowerCase() !== String(expectedAccount).toLowerCase()) {
        throw new Error('The quote no longer matches the connected wallet.')
    }
    if (!isHex(transaction.data ?? '') || transaction.data === '0x') {
        throw new Error('The quote does not contain valid transaction data.')
    }
    const request = { to: transaction.to, data: transaction.data, value: parseQuantity(transaction.value, 'value'), chainId }
    if (transaction.gas !== undefined) request.gas = parseQuantity(transaction.gas, 'gas limit')
    return request
}
