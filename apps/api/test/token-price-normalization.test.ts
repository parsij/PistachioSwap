import { describe, expect, it } from 'vitest'

import { tokenPriceInternals } from '../src/providers/alchemy/token-prices.js'

const { normalizeUsdPrice } = tokenPriceInternals

describe('provider USD price normalization', () => {
    it('keeps values that already fit USD micros', () => {
        expect(normalizeUsdPrice('4187.123456')).toBe('4187.123456')
        expect(normalizeUsdPrice('4187.12')).toBe('4187.12')
        expect(normalizeUsdPrice('4187')).toBe('4187')
    })

    it('rounds provider values with more than six decimal places', () => {
        expect(normalizeUsdPrice('4187.1234564')).toBe('4187.123456')
        expect(normalizeUsdPrice('4187.1234565')).toBe('4187.123457')
        expect(normalizeUsdPrice('0.9999999')).toBe('1')
    })

    it('rejects invalid provider values without using floating point math', () => {
        expect(normalizeUsdPrice('-1')).toBeNull()
        expect(normalizeUsdPrice('1e3')).toBeNull()
        expect(normalizeUsdPrice('not-a-price')).toBeNull()
    })
})
