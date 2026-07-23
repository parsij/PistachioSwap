import { describe, expect, it } from 'vitest'

import {
    filterPortfolioTokens,
    getHiddenPortfolioTokens,
    getUnverifiedPortfolioTokens,
    isTrustedWalletToken,
} from './portfolio.js'

const recognized = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000001',
    balance: '1',
    valueUSD: '0.19',
    recognitionStatus: 'recognized',
    recognitionReasons: ['coingecko-exact-contract'],
    possibleSpam: false,
    securityStatus: 'low',
    priceConfidence: 'trusted',
    includeInPortfolioValue: true,
    visibility: 'primary',
}
const unverified = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000002',
    balance: '10',
    valueUSD: null,
    visibility: 'unverified',
}
const risky = {
    ...unverified,
    address: '0x0000000000000000000000000000000000000004',
    visibility: 'hidden',
}
const missingPrice = {
    ...recognized,
    address: '0x0000000000000000000000000000000000000003',
    valueUSD: null,
}
const secantX = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000eca',
    name: 'SecantX AI',
    symbol: 'SECA',
    balance: '1',
    valueUSD: null,
    marketPriceUSD: '447463.12',
    verifiedContract: true,
    possibleSpam: false,
    securityStatus: 'low',
    priceConfidence: 'untrusted',
    recognitionStatus: 'unverified',
    recognitionReasons: [
        'moralis-verified-contract',
        'trusted-market-contract',
        'market-catalog-only',
    ],
    includeInPortfolioValue: false,
    visibility: 'hidden',
}

describe('portfolio presentation filters', () => {
    it('removes hidden unknown assets from presentation without mutating wallet data', () => {
        const data = [recognized, unverified, risky]
        expect(filterPortfolioTokens(data, { hideUnknownTokens: true })).toEqual([recognized])
        expect(data).toHaveLength(3)
        expect(data[1]).toBe(unverified)
    })

    it('reveals unknown assets only through the collapsed hidden collection', () => {
        expect(getUnverifiedPortfolioTokens([recognized, unverified, risky], {
            hideUnknownTokens: false,
        })).toEqual([unverified])
        expect(getHiddenPortfolioTokens([recognized, unverified, risky], {
            hideUnknownTokens: false,
        })).toEqual([risky])
    })

    it('builds non-primary collections independently from the presentation setting', () => {
        expect(getUnverifiedPortfolioTokens([recognized, unverified, risky], {
            hideUnknownTokens: true,
        })).toEqual([unverified])
        expect(getHiddenPortfolioTokens([recognized, unverified, risky], {
            hideUnknownTokens: true,
        })).toEqual([risky])
    })

    it('uses the exact 20 cent threshold and keeps missing prices', () => {
        expect(filterPortfolioTokens([recognized, missingPrice], {
            hideSmallBalances: true,
        })).toEqual([missingPrice])
        expect(filterPortfolioTokens([{ ...recognized, valueUSD: '0.20' }], {
            hideSmallBalances: true,
        })).toHaveLength(1)
        expect(filterPortfolioTokens([recognized], {
            hideSmallBalances: true,
            hideUnknownTokens: false,
        })).toEqual([recognized])
    })

    it('never promotes a selected hidden token into the primary collection', () => {
        expect(filterPortfolioTokens([unverified], {
            hideUnknownTokens: true,
            hideSmallBalances: true,
            selectedTokens: [unverified],
        })).toEqual([])
    })

    it('does not trust verifiedContract, Moralis verification, or market catalog reasons by themselves', () => {
        expect(isTrustedWalletToken(secantX)).toBe(false)
        expect(filterPortfolioTokens([recognized, secantX], {
            hideUnknownTokens: true,
        })).toEqual([recognized])
    })

    it('fails closed when visibility is missing', () => {
        expect(filterPortfolioTokens([{ ...unverified, visibility: undefined }]))
            .toEqual([])
        expect(getHiddenPortfolioTokens([{ ...unverified, visibility: undefined }], {
            hideUnknownTokens: false,
        })).toHaveLength(0)
        expect(getUnverifiedPortfolioTokens([{ ...unverified, visibility: undefined }], {
            hideUnknownTokens: false,
        })).toHaveLength(0)
    })
})
