export const AUTO_SLIPPAGE_BPS = 250
export const HIGH_SLIPPAGE_BPS = 550
export const VERY_HIGH_SLIPPAGE_BPS = 2200
export const MAX_SLIPPAGE_BPS = 10_000
export const MIN_SLIPPAGE_BPS = 1

/** Formats basis points using the settings panel's existing percentage labels. */
export function formatSlippageBps(bps) {
    if (!Number.isInteger(bps) || bps < 0) return '0%'
    const whole = Math.floor(bps / 100)
    const fraction = bps % 100
    if (fraction === 0) return `${whole}%`
    return `${whole}.${String(fraction).padStart(2, '0').replace(/0+$/, '')}%`
}

/** Formats a valid basis-point value for the editable input without its percent sign. */
export function formatSlippageInput(bps) {
    return formatSlippageBps(bps).replace('%', '')
}

/**
 * Validates the editable slippage string without reading React state or storage.
 * @param {unknown} value User-entered percentage text.
 * @returns {{valid: boolean, empty: boolean, bps: number|null, error: string|null}} Structured result.
 */
export function parseSlippageInput(value) {
    const normalized = String(value).trim()
    if (normalized === '') return { valid: false, empty: true, bps: null, error: null }
    if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return { valid: false, empty: false, bps: null, error: 'Enter a valid percentage.' }
    const [wholePart, fractionPart = ''] = normalized.split('.')
    const totalBps = BigInt(wholePart) * 100n + BigInt(fractionPart.padEnd(2, '0'))
    if (totalBps < BigInt(MIN_SLIPPAGE_BPS)) return { valid: false, empty: false, bps: null, error: 'Slippage must be at least 0.01%.' }
    if (totalBps > BigInt(MAX_SLIPPAGE_BPS)) return { valid: false, empty: false, bps: null, error: 'Slippage cannot exceed 100%.' }
    return { valid: true, empty: false, bps: Number(totalBps), error: null }
}

/** Returns the existing warning severity for a valid custom slippage value. */
export function getSlippageSeverity(bps) {
    if (!Number.isInteger(bps)) return 'normal'
    if (bps > VERY_HIGH_SLIPPAGE_BPS) return 'very-high'
    if (bps > HIGH_SLIPPAGE_BPS) return 'high'
    return 'normal'
}

/** Maps warning severity to the existing visible label, or null for normal values. */
export function getWarningLabel(severity) {
    if (severity === 'very-high') return 'Very high slippage'
    if (severity === 'high') return 'High slippage'
    return null
}
