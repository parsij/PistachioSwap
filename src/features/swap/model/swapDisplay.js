import { formatUsdAmount } from '../../../services/fiatValue.js'
import { getTokenDisplaySymbol } from '../../tokens/services/tokenDisplay.js'
import { formatWalletTokenAmount } from '../../tokens/services/walletTokens.js'

const TOKEN_INPUT_FRACTION_DIGITS = 6
const USD_INPUT_FRACTION_DIGITS = 2
const RATE_SIGNIFICANT_DIGITS = 6
const RATE_MAX_FRACTION_DIGITS = 12

/**
 * Shortens a decimal amount for display without grouping commas.
 * The exact source string is left unchanged so Max still quotes the full balance.
 * @param {string} value Editable decimal string.
 * @param {number} [maxFractionDigits=6] Fraction digits kept after rounding.
 * @returns {string} Compact decimal, or the original text when it is not a number.
 */
export function formatCompactAmountInput(value, maxFractionDigits = TOKEN_INPUT_FRACTION_DIGITS) {
    const text = String(value ?? '').trim()
    if (!text) return ''
    const match = /^(\d+)(?:\.(\d*))?$/.exec(text)
    if (!match) return text

    const whole = match[1].replace(/^0+(?=\d)/, '') || '0'
    const fraction = match[2] ?? ''
    if (!fraction) return whole
    if (fraction.length <= maxFractionDigits) {
        const trimmed = fraction.replace(/0+$/, '')
        return trimmed ? `${whole}.${trimmed}` : whole
    }

    const digits = `${whole}${fraction}`
    const extra = fraction.length - maxFractionDigits
    const divisor = 10n ** BigInt(extra)
    const integer = BigInt(digits)
    let rounded = integer / divisor
    if ((integer % divisor) * 2n >= divisor) rounded += 1n

    const padded = rounded.toString().padStart(maxFractionDigits + 1, '0')
    const nextWhole = padded.slice(0, -maxFractionDigits).replace(/^0+(?=\d)/, '') || '0'
    const nextFraction = padded.slice(-maxFractionDigits).replace(/0+$/, '')
    return nextFraction ? `${nextWhole}.${nextFraction}` : nextWhole
}

/** @returns {string} Compact value shown in the amount field while it is not focused. */
export function formatAmountInputDisplay(value, denomination) {
    const maxFractionDigits = denomination === 'USD'
        ? USD_INPUT_FRACTION_DIGITS
        : TOKEN_INPUT_FRACTION_DIGITS
    return formatCompactAmountInput(value, maxFractionDigits)
}

/** @returns {string} Short token amount plus a safe symbol for the panel secondary line. */
export function formatSwapSecondaryTokenAmount(amount, token) {
    if (!token) return '0'
    return `${formatWalletTokenAmount(amount)} ${getTokenDisplaySymbol(token)}`.trim()
}

function formatRateNumber(value) {
    return value.toLocaleString(undefined, {
        useGrouping: false,
        maximumSignificantDigits: RATE_SIGNIFICANT_DIGITS,
        maximumFractionDigits: RATE_MAX_FRACTION_DIGITS,
    })
}

/** @returns {string} Compact exchange-rate label or the existing unavailable label. */
export function formatCompactRate(sellValue, sellSymbol, buyValue, buySymbol) {
    const sell = Number(sellValue)
    const buy = Number(buyValue)
    if (!Number.isFinite(sell) || !Number.isFinite(buy) || sell <= 0 || buy <= 0) {
        return 'Rate unavailable'
    }

    const rate = buy / sell
    if (!Number.isFinite(rate) || rate <= 0) return 'Rate unavailable'
    return `1 ${sellSymbol} = ${formatRateNumber(rate)} ${buySymbol}`
}

/** @returns {string|null} Existing USD cost label, optionally prefixed as an estimate. */
export function formatCostUsd(value, approximate = false) {
    if (value === null || value === undefined) return null
    const formatted = formatUsdAmount(value, '1')
    return approximate ? `~${formatted}` : formatted
}
