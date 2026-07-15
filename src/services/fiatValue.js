function normalizedDecimal(value) {
    const text = String(value ?? '').trim()
    if (!/^\d+(?:\.\d+)?$/.test(text)) return null
    const [whole, fraction = ''] = text.split('.')
    return {
        digits: `${whole}${fraction}`.replace(/^0+(?=\d)/, ''),
        scale: fraction.length,
    }
}

export function multiplyUsdAmount(amount, priceUSD) {
    const left = normalizedDecimal(amount)
    const right = normalizedDecimal(priceUSD)
    if (!left || !right) return null

    const product = BigInt(left.digits) * BigInt(right.digits)
    const scale = left.scale + right.scale
    if (scale === 0) return product.toString()
    const padded = product.toString().padStart(scale + 1, '0')
    const whole = padded.slice(0, -scale)
    const fraction = padded.slice(-scale).replace(/0+$/, '')
    return fraction ? `${whole}.${fraction}` : whole
}

export function formatUsdAmount(amount, priceUSD) {
    const parsedAmount = normalizedDecimal(amount)
    if (!parsedAmount) return priceUSD == null ? '—' : '$0'
    if (BigInt(parsedAmount.digits) === 0n) return '$0'

    const value = multiplyUsdAmount(amount, priceUSD)
    if (value === null) return '—'
    if (!/[1-9]/.test(value)) return '$0'
    const [whole, fraction = ''] = value.split('.')
    if (BigInt(whole) === 0n && BigInt((fraction || '0').padEnd(2, '0').slice(0, 2)) === 0n) {
        return '<$0.01'
    }

    const centsDigits = fraction.padEnd(3, '0')
    let cents = BigInt(whole) * 100n + BigInt(centsDigits.slice(0, 2))
    if (Number(centsDigits[2] ?? '0') >= 5) cents += 1n
    const roundedWhole = cents / 100n
    const roundedFraction = (cents % 100n).toString().padStart(2, '0')
    const grouped = roundedWhole
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return `$${grouped}.${roundedFraction}`
}
