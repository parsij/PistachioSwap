import { describe, expect, it } from 'vitest'

import { moralisSponsorshipEvidenceInternals } from '../src/providers/moralis/sponsorship-token-evidence.js'

const address = '0x21caef8a43163eea865baee23b9c2e327696a3bf'
const { normalizeMoralisSponsorshipTokenEvidence, normalizedDecimal } =
    moralisSponsorshipEvidenceInternals

describe('Moralis sponsorship token evidence', () => {
    it('normalizes price, liquidity, score, spam, and verification fields', () => {
        const result = normalizeMoralisSponsorshipTokenEvidence({
            tokenAddress: address,
            usdPriceFormatted: '4068.8960954',
            pairTotalLiquidityUsd: '1234567.8912349',
            securityScore: 88,
            possibleSpam: 'false',
            verifiedContract: true,
            pairAddress: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
            exchangeAddress: '0x0000000085e102724e78ecd2f45dc9ca239affad',
            exchangeName: 'Uniswap v3',
        }, address)

        expect(result.available).toBe(true)
        expect(result.priceUsd).toBe('4068.896095')
        expect(result.liquidityUsd).toBe('1234567.891235')
        expect(result.securityScore).toBe(88)
        expect(result.possibleSpam).toBe(false)
        expect(result.verifiedContract).toBe(true)
    })

    it('rejects a mismatched returned token address', () => {
        const result = normalizeMoralisSponsorshipTokenEvidence({
            tokenAddress: '0x0000000000000000000000000000000000000001',
            usdPriceFormatted: '1',
        }, address)

        expect(result.available).toBe(false)
    })

    it('normalizes decimal values without floating point math', () => {
        expect(normalizedDecimal('0.9999999')).toBe('1')
        expect(normalizedDecimal('100.1234564')).toBe('100.123456')
        expect(normalizedDecimal('1e3')).toBeNull()
    })
})
