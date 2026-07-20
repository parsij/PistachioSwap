/** @returns {string|null} Raw integer units, or null for invalid/over-precision input. */
export function decimalToUnits(value, decimals) {
    const normalized = String(value).trim()
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
    const [wholePart, fractionPart = ''] = normalized.split('.')
    if (fractionPart.length > decimals) return null
    return `${wholePart}${fractionPart.padEnd(decimals, '0')}`
        .replace(/^0+(?=\d)/, '')
        .replace(/^$/, '0')
}

function decimalToParts(value) {
    const normalized = String(value ?? '').trim()
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
    const [whole, fraction = ''] = normalized.split('.')
    return { digits: `${whole}${fraction}`.replace(/^0+(?=\d)/, '') || '0', scale: fraction.length }
}

/** @returns {string|null} Integer token units after decimal division. */
export function divideDecimalToUnits(value, divisor, decimals, rounding = 'down') {
    const numerator = decimalToParts(value)
    const denominator = decimalToParts(divisor)
    if (!numerator || !denominator || BigInt(denominator.digits) <= 0n) return null
    const scaledNumerator = BigInt(numerator.digits) * (10n ** BigInt(decimals)) * (10n ** BigInt(denominator.scale))
    const scaledDenominator = BigInt(denominator.digits) * (10n ** BigInt(numerator.scale))
    const quotient = scaledNumerator / scaledDenominator
    const remainder = scaledNumerator % scaledDenominator
    return (rounding === 'up' && remainder > 0n ? quotient + 1n : quotient).toString()
}

/** @returns {string|null} Exact decimal product of raw token units and a decimal multiplier. */
export function multiplyUnitsByDecimal(value, decimals, multiplier) {
    const amount = /^\d+$/.test(String(value ?? '')) ? BigInt(value) : null
    const price = decimalToParts(multiplier)
    if (amount === null || !price) return null
    const product = amount * BigInt(price.digits)
    const scale = BigInt(decimals + price.scale)
    const denominator = 10n ** scale
    const whole = product / denominator
    const remainder = product % denominator
    if (remainder === 0n) return whole.toString()
    const fraction = remainder.toString().padStart(Number(scale), '0').replace(/0+$/, '')
    return `${whole}.${fraction}`
}

/** @returns {boolean} Whether a string is an editable non-negative decimal input. */
export function isDecimalInput(value) {
    return /^\d*(?:\.\d*)?$/.test(String(value ?? ''))
}

/** @returns {-1|0|1|null} Exact decimal ordering, or null for invalid input. */
export function compareDecimalStrings(leftValue, rightValue) {
    const left = decimalToParts(leftValue)
    const right = decimalToParts(rightValue)
    if (!left || !right) return null
    const scale = Math.max(left.scale, right.scale)
    const leftUnits = BigInt(left.digits) * (10n ** BigInt(scale - left.scale))
    const rightUnits = BigInt(right.digits) * (10n ** BigInt(scale - right.scale))
    if (leftUnits === rightUnits) return 0
    return leftUnits > rightUnits ? 1 : -1
}

/** @returns {number|null} Integer basis-point ratio or null for invalid/zero denominator. */
export function decimalRatioBps(numeratorValue, denominatorValue) {
    const numerator = decimalToParts(numeratorValue)
    const denominator = decimalToParts(denominatorValue)
    if (!numerator || !denominator || BigInt(denominator.digits) === 0n) return null
    const scaledNumerator = BigInt(numerator.digits) * 10_000n * (10n ** BigInt(denominator.scale))
    const scaledDenominator = BigInt(denominator.digits) * (10n ** BigInt(numerator.scale))
    return Number(scaledNumerator / scaledDenominator)
}

/** @returns {string|null} Decimal token amount, or null for a non-integer raw amount. */
export function unitsToDecimal(value, decimals) {
    const normalized = String(value ?? '')
    if (!/^\d+$/.test(normalized)) return null
    const padded = normalized.padStart(decimals + 1, '0')
    const whole = decimals > 0 ? padded.slice(0, -decimals) : padded
    const fraction = decimals > 0 ? padded.slice(-decimals).replace(/0+$/, '') : ''
    return fraction ? `${whole}.${fraction}` : whole
}

/** @returns {string|null} Normalized buy amount from supported quote response shapes. */
export function normalizeQuoteAmount(response, decimals) {
    const amount = [
        response?.selectedQuote?.buyAmount,
        response?.buyAmount,
        response?.toAmount,
        response?.amountOut,
        response?.quote?.buyAmount,
        response?.quote?.toAmount,
        response?.data?.buyAmount,
        response?.data?.toAmount,
    ].find((value) => value !== undefined && value !== null)
    return amount === undefined ? null : unitsToDecimal(amount, decimals)
}

/** @returns {string|null} Normalized sell amount from supported quote response shapes. */
export function normalizeQuoteSellAmount(response, decimals) {
    const amount = [
        response?.selectedQuote?.maximumSellAmount,
        response?.selectedQuote?.sellAmount,
        response?.maximumSellAmount,
        response?.sellAmount,
    ].find((value) => value !== undefined && value !== null)
    return amount === undefined ? null : unitsToDecimal(amount, decimals)
}
