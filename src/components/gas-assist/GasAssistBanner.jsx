import { formatUnits } from 'viem'

function formattedFee(fee, token) {
    if (!fee?.amount || !token) return null
    try {
        return `${formatUnits(BigInt(fee.amount), Number(token.decimals ?? 18))} ${token.symbol}`
    } catch {
        return null
    }
}

export default function GasAssistBanner({ quote, sellToken, buyToken }) {
    const integratorFee = quote?.fees?.integratorFee ?? quote?.fees?.integratorFees?.[0]
    const networkFee = quote?.fees?.gasFee
    const protocolFee = quote?.fees?.zeroExFee
    const minimum = quote?.minBuyAmount && buyToken
        ? formatUnits(BigInt(quote.minBuyAmount), Number(buyToken.decimals ?? 18))
        : null
    return (
        <aside className="gas-assist-banner" aria-label="Gas Assist information">
            <span className="gas-assist-badge">Gas Assist · Powered by 0x</span>
            <strong>You have no native token to pay for gas, but we’ve got you.</strong>
            <p>Gas Assist will use 0x Gasless to complete this swap. Network costs are included in the quote.</p>
            <p>PistachioSwap fee: 3% + $0.067, capped at $5</p>
            {quote && (
                <dl>
                    <div><dt>PistachioSwap fee</dt><dd>{formattedFee(integratorFee, sellToken) ?? 'Unavailable'}</dd></div>
                    <div><dt>Estimated fee USD</dt><dd>{quote.fee?.estimatedFeeUsd ? `$${quote.fee.estimatedFeeUsd}` : 'Unavailable'}</dd></div>
                    <div><dt>Dynamic fee</dt><dd>{quote.fee?.dynamicFeeBps != null ? `${quote.fee.dynamicFeeBps} BPS` : 'Unavailable'}</dd></div>
                    <div><dt>0x gas/network cost</dt><dd>{formattedFee(networkFee, sellToken) ?? 'Included by 0x'}</dd></div>
                    {protocolFee?.amount && <div><dt>0x protocol fee</dt><dd>{formattedFee(protocolFee, sellToken)}</dd></div>}
                    <div><dt>Minimum output</dt><dd>{minimum ? `${minimum} ${buyToken.symbol}` : 'Unavailable'}</dd></div>
                </dl>
            )}
        </aside>
    )
}
