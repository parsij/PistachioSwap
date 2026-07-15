import { describe, expect, it } from 'vitest'

import {
    DEFAULT_SWAP_SETTINGS,
    getEffectiveSlippageBps,
    parseSlippagePercentage,
    readSwapSettings,
    SWAP_SETTINGS_STORAGE_KEY,
    writeSwapSettings,
} from './swapSettings.js'

function storage() {
    const values = new Map()
    return {
        values,
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    }
}

describe('swap settings', () => {
    it('defaults to automatic slippage and hides unknown tokens', () => {
        expect(readSwapSettings(storage())).toEqual(DEFAULT_SWAP_SETTINGS)
    })

    it('uses recommended automatic slippage then configured fallback', () => {
        expect(getEffectiveSlippageBps(DEFAULT_SWAP_SETTINGS, {
            recommendedSlippageBps: 75,
            defaultSlippageBps: 50,
        })).toBe(75)
        expect(getEffectiveSlippageBps(DEFAULT_SWAP_SETTINGS, {
            defaultSlippageBps: 50,
        })).toBe(50)
    })

    it('converts ordinary custom percentages to integer basis points', () => {
        expect(parseSlippagePercentage('0.1').bps).toBe(10)
        expect(parseSlippagePercentage('0.5').bps).toBe(50)
        expect(parseSlippagePercentage('1').bps).toBe(100)
        expect(parseSlippagePercentage('5.5').bps).toBe(550)
        expect(parseSlippagePercentage('60').bps).toBe(6_000)
        expect(parseSlippagePercentage('100').bps).toBe(10_000)
    })

    it('rejects zero, negative, NaN, malformed, and excessive slippage', () => {
        for (const value of ['0', '-1', 'NaN', '1.234', '100.01']) {
            expect(parseSlippagePercentage(value).valid).toBe(false)
        }
    })

    it('keeps slippage over 50 percent active for the current page', () => {
        expect(getEffectiveSlippageBps({
            slippageMode: 'custom',
            customSlippageBps: 6_000,
        })).toBe(6_000)
    })

    it('keeps custom slippage in memory but resets it after a reload', () => {
        const target = storage()
        const currentPage = writeSwapSettings({
            slippageMode: 'custom',
            customSlippageBps: 55,
            hideUnknownTokens: false,
            hideSmallBalances: true,
        }, target)

        expect(currentPage).toMatchObject({
            slippageMode: 'custom',
            customSlippageBps: 55,
        })
        expect([...target.values.keys()]).toEqual([SWAP_SETTINGS_STORAGE_KEY])
        expect(readSwapSettings(target)).toMatchObject({
            slippageMode: 'auto',
            customSlippageBps: null,
            hideUnknownTokens: false,
            hideSmallBalances: true,
        })
    })

    it('discards custom slippage saved by older versions', () => {
        const target = storage()
        target.setItem(SWAP_SETTINGS_STORAGE_KEY, JSON.stringify({
            slippageMode: 'custom',
            customSlippageBps: 500,
            hideUnknownTokens: true,
            hideSmallBalances: false,
        }))

        expect(readSwapSettings(target)).toEqual(DEFAULT_SWAP_SETTINGS)
    })
})
