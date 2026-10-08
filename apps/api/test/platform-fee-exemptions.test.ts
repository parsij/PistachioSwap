import { describe, expect, it } from 'vitest'
import { isNormalQuotePlatformFeeExemptWallet } from '../src/lib/platform-fee-exemptions.js'

describe('normal quote platform-fee exemption list', () => {
    const exempt = [
        '0x2941909551C7ceFd9EbEB1C5200D8B614CF887Ca',
        '0x153812707d3999Ad579c477e1a034b077013d4BF',
    ]
    it.each(exempt)('exempts %s regardless of casing', address => {
        expect(isNormalQuotePlatformFeeExemptWallet(address)).toBe(true)
        expect(isNormalQuotePlatformFeeExemptWallet(address.toLowerCase())).toBe(true)
        expect(isNormalQuotePlatformFeeExemptWallet(address.toUpperCase().replace(/^0X/, '0x'))).toBe(true)
    })
    it('does not exempt other or malformed addresses', () => {
        expect(isNormalQuotePlatformFeeExemptWallet('0x1111111111111111111111111111111111111111')).toBe(false)
        expect(isNormalQuotePlatformFeeExemptWallet('0x153812707d3999Ad579c477e1a034b077013d4BE')).toBe(false)
        expect(isNormalQuotePlatformFeeExemptWallet('not-an-address')).toBe(false)
        expect(isNormalQuotePlatformFeeExemptWallet(null)).toBe(false)
    })
})
