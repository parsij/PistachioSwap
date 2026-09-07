import { describe, expect, it } from 'vitest'

import { formatCompactRate } from './swapDisplay.js'

describe('formatCompactRate', () => {
    it('uses readable significant digits for ordinary rates', () => {
        expect(formatCompactRate('1', 'USD₮', '12.6956', 'CELO'))
            .toBe('1 USD₮ = 12.6956 CELO')
        expect(formatCompactRate('1', 'WETH', '2489.63', 'USDT'))
            .toBe('1 WETH = 2489.63 USDT')
    })

    it('keeps useful precision for small rates without scientific notation', () => {
        expect(formatCompactRate('1', 'USDT', '0.00135293', 'BNB'))
            .toBe('1 USDT = 0.00135293 BNB')
        expect(formatCompactRate('1', 'USDT', '0.000401665', 'WETH'))
            .toBe('1 USDT = 0.000401665 WETH')
    })

    it('rounds noisy rates to six significant digits', () => {
        expect(formatCompactRate('0.1167', 'FDUSD', '0.134513', 'POL'))
            .toBe('1 FDUSD = 1.15264 POL')
    })

    it('keeps the unavailable state for invalid values', () => {
        expect(formatCompactRate('0', 'A', '1', 'B')).toBe('Rate unavailable')
        expect(formatCompactRate('1', 'A', '', 'B')).toBe('Rate unavailable')
    })
})
