/** Market data is optional. Never coerce null/empty strings to a fabricated zero. */
export function marketNumber(value) {
    if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
}

export function marketUsd(value, compact = false) {
    const number = marketNumber(value)
    if (number === null) return '—'
    return number.toLocaleString(undefined, {
        style: 'currency', currency: 'USD',
        ...(compact && Math.abs(number) >= 10_000 ? { notation: 'compact', maximumFractionDigits: 1 }
            : Math.abs(number) >= 1 ? { maximumFractionDigits: 2 }
                : { maximumSignificantDigits: 6 }),
    })
}

export function marketPercent(value) {
    const number = marketNumber(value)
    return number === null ? '—' : `${number > 0 ? '+' : ''}${number.toFixed(2)}%`
}
