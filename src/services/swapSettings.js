export const SWAP_SETTINGS_STORAGE_KEY =
    'pistachioswap:swap-settings:v1'

export const DEFAULT_SWAP_SETTINGS = Object.freeze({
    slippageMode: 'auto',
    customSlippageBps: null,
    hideUnknownTokens: true,
    hideSmallBalances: false,
})

export const MAX_CUSTOM_SLIPPAGE_BPS = 10_000
export const HIGH_SLIPPAGE_WARNING_BPS = 500

export function parseSlippagePercentage(value) {
    const text = String(value ?? '').trim()
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text)
    if (!match) {
        return { valid: false, bps: null, error: 'Enter a valid percentage.' }
    }

    const bps =
        BigInt(match[1]) * 100n +
        BigInt((match[2] ?? '').padEnd(2, '0') || '0')

    if (bps <= 0n) {
        return { valid: false, bps: null, error: 'Slippage must be greater than 0%.' }
    }

    if (bps > BigInt(MAX_CUSTOM_SLIPPAGE_BPS)) {
        return { valid: false, bps: null, error: 'Slippage cannot exceed 100%.' }
    }

    return { valid: true, bps: Number(bps), error: null }
}

export function formatSlippageBps(bps) {
    if (!Number.isInteger(bps) || bps < 0) return '0%'
    const whole = Math.floor(bps / 100)
    const fraction = String(bps % 100).padStart(2, '0').replace(/0+$/, '')
    return `${whole}${fraction ? `.${fraction}` : ''}%`
}

export function getEffectiveSlippageBps(
    settings,
    { recommendedSlippageBps = null, defaultSlippageBps = 50 } = {},
) {
    if (
        settings?.slippageMode === 'custom' &&
        Number.isInteger(settings.customSlippageBps) &&
        settings.customSlippageBps > 0 &&
        settings.customSlippageBps <= MAX_CUSTOM_SLIPPAGE_BPS
    ) {
        return settings.customSlippageBps
    }

    if (
        Number.isInteger(recommendedSlippageBps) &&
        recommendedSlippageBps > 0 &&
        recommendedSlippageBps <= MAX_CUSTOM_SLIPPAGE_BPS
    ) {
        return recommendedSlippageBps
    }

    return Number.isInteger(defaultSlippageBps) && defaultSlippageBps > 0
        ? defaultSlippageBps
        : 50
}

export function normalizeSwapSettings(value) {
    const custom = Number(value?.customSlippageBps)
    return {
        slippageMode:
            value?.slippageMode === 'custom' &&
            Number.isInteger(custom) &&
            custom > 0 &&
            custom <= MAX_CUSTOM_SLIPPAGE_BPS
                ? 'custom'
                : 'auto',
        customSlippageBps:
            Number.isInteger(custom) &&
            custom > 0 &&
            custom <= MAX_CUSTOM_SLIPPAGE_BPS
                ? custom
                : null,
        hideUnknownTokens:
            value?.hideUnknownTokens === undefined
                ? true
                : value.hideUnknownTokens === true,
        hideSmallBalances: value?.hideSmallBalances === true,
    }
}

export function readSwapSettings(storage = globalThis.localStorage) {
    if (!storage) return { ...DEFAULT_SWAP_SETTINGS }
    try {
        const stored = JSON.parse(storage.getItem(SWAP_SETTINGS_STORAGE_KEY))
        return {
            ...normalizeSwapSettings(stored),
            slippageMode: 'auto',
            customSlippageBps: null,
        }
    } catch {
        return { ...DEFAULT_SWAP_SETTINGS }
    }
}

export function writeSwapSettings(settings, storage = globalThis.localStorage) {
    const normalized = normalizeSwapSettings(settings)
    storage?.setItem(SWAP_SETTINGS_STORAGE_KEY, JSON.stringify({
        ...normalized,
        slippageMode: 'auto',
        customSlippageBps: null,
    }))
    return normalized
}
