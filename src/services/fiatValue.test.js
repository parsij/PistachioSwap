import { describe, expect, it } from 'vitest'

import { formatUsdAmount, multiplyUsdAmount } from './fiatValue.js'

describe('fiat value formatting', () => {
    it('multiplies token amounts by exact-address decimal prices', () => {
        expect(multiplyUsdAmount('1.25', '570.1234')).toBe('712.65425')
        expect(formatUsdAmount('1.25', '570.1234')).toBe('$712.65')
    })

    it('distinguishes zero, sub-cent, and unavailable prices', () => {
        expect(formatUsdAmount('0', null)).toBe('$0')
        expect(formatUsdAmount('0.00001', '1')).toBe('<$0.01')
        expect(formatUsdAmount('2', null)).toBe('—')
    })

    it('groups larger values without converting raw quantities to Number', () => {
        expect(formatUsdAmount('12345678901234567890', '2')).toBe(
            '$24,691,357,802,469,135,780.00',
        )
    })
})
