import { formatUsdAmount } from '../../../services/fiatValue.js'

/** @returns {string} Compact exchange-rate label or the existing unavailable label. */
export function formatCompactRate(sellValue, sellSymbol, buyValue, buySymbol) {
    const sell = Number(sellValue)
    const buy = Number(buyValue)
    if (!Number.isFinite(sell) || !Number.isFinite(buy) || sell <= 0 || buy <= 0) {
        return 'Rate unavailable'
    }
    return `1 ${sellSymbol} = ${(buy / sell).toLocaleString(undefined, {
        maximumFractionDigits: 6,
    })} ${buySymbol}`
}

/** @returns {string|null} Existing USD cost label, optionally prefixed as an estimate. */
export function formatCostUsd(value, approximate = false) {
    if (value === null || value === undefined) return null
    const formatted = formatUsdAmount(value, '1')
    return approximate ? `~${formatted}` : formatted
}
