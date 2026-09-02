import { describe, expect, it } from 'vitest'

import {
    getGasAssistFeeBreakdown,
    requireGasAssistFeeBreakdown,
    usdDecimalToMicros,
    usdMicrosToDecimal,
} from './gasAssistFee.js'

function quote(overrides = {}) {
    const value = {
        grossInputAmountRaw: '1000000',
        netSwapAmountRaw: '900000',
        paymentAmountRaw: '100000',
        expectedOutputRaw: '2000000',
        minimumOutputRaw: '1900000',
        amountsUsd: {
            tradeNotional: '10',
            commercialFee: '0.60',
            gasReserve: '0.40',
            estimatedSponsoredGas: '0.30',
            totalPrepayment: '1',
            ...overrides.amountsUsd,
        },
        ...overrides,
    }
    value.amountsUsd = {
        tradeNotional: '10',
        commercialFee: '0.60',
        gasReserve: '0.40',
        estimatedSponsoredGas: '0.30',
        totalPrepayment: '1',
        ...overrides.amountsUsd,
    }
    return value
}

describe('Gas Assist fee safety', () => {
    it('preserves exact fixed-point USD values without floating-point math', () => {
        expect(usdDecimalToMicros('12.345678')).toBe(12_345_678n)
        expect(usdDecimalToMicros('12.3456789')).toBeNull()
        expect(usdDecimalToMicros('-1')).toBeNull()
        expect(usdMicrosToDecimal(12_345_678n)).toBe('12.345678')
        expect(usdMicrosToDecimal(1_000_000n)).toBe('1')
    })

    it('accepts an exact fee plus net-input identity and exposes all-in costs', () => {
        const fees = getGasAssistFeeBreakdown(quote({
            amountsUsd: {
                routeCost: '0.25',
                allInCost: '1.25',
            },
        }))
        expect(fees).toMatchObject({
            totalFeeRaw: 100_000n,
            totalFeeUsdMicros: 1_000_000n,
            networkReserveUsdMicros: 400_000n,
            routeCostUsdMicros: 250_000n,
            allInCostUsdMicros: 1_250_000n,
        })
    })

    it('rejects hidden leftovers, fees that consume the input, and uneconomic all-in costs', () => {
        expect(getGasAssistFeeBreakdown(quote({ netSwapAmountRaw: '899999' }))).toBeNull()
        expect(getGasAssistFeeBreakdown(quote({
            netSwapAmountRaw: '1',
            paymentAmountRaw: '999999',
            amountsUsd: { totalPrepayment: '10' },
        }))).toBeNull()
        expect(getGasAssistFeeBreakdown(quote({
            amountsUsd: { routeCost: '9', allInCost: '10' },
        }))).toBeNull()
        expect(() => requireGasAssistFeeBreakdown(quote({ netSwapAmountRaw: '800000' })))
            .toThrow(/inconsistent fee/i)
    })
})
