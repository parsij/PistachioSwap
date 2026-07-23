import { describe, expect, it } from 'vitest'

import {
    sanitizeStoredToken,
    sortWalletTokens,
} from './tokenSelectorState.js'

const coreBnb = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000000',
    isNative: true,
    name: 'BNB',
    symbol: 'BNB',
    balance: '1',
    valueUSD: '600',
    trustedPriceUSD: '600',
    priceConfidence: 'trusted',
    includeInPortfolioValue: true,
    visibility: 'primary',
    classificationTier: 'core',
    classificationReasons: ['core-asset'],
    recognitionReasons: ['native-token'],
}

const establishedToken = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000010',
    name: 'Established Token',
    symbol: 'EST',
    balance: '100',
    valueUSD: '10000',
    trustedPriceUSD: '100',
    priceConfidence: 'trusted',
    includeInPortfolioValue: true,
    visibility: 'primary',
    classificationTier: 'established',
    classificationReasons: ['established-market-asset'],
    recognitionStatus: 'established',
}

const hiddenFakeValue = {
    chainId: 56,
    address: '0xfec3cf1a1c9288813585984cd6a457f22fcd2cee',
    name: 'SecantX AI',
    symbol: 'SECA',
    balance: '1',
    marketPriceUSD: '447463.12',
    valueUSD: null,
    trustedPriceUSD: null,
    priceConfidence: 'untrusted',
    includeInPortfolioValue: false,
    visibility: 'hidden',
    classificationTier: 'hidden',
    classificationReasons: ['insufficient-trusted-liquidity'],
    recognitionStatus: 'unverified',
}

describe('token selector state helpers', () => {
    it('keeps core and established wallet assets ahead of fake-valued hidden tokens', () => {
        expect(sortWalletTokens([hiddenFakeValue, establishedToken, coreBnb]))
            .toEqual([coreBnb, establishedToken, hiddenFakeValue])
    })

    it('persists hidden recent-search records as untrusted diagnostics', () => {
        expect(sanitizeStoredToken(hiddenFakeValue)).toMatchObject({
            address: hiddenFakeValue.address,
            classificationTier: 'hidden',
            classificationReasons: ['insufficient-trusted-liquidity'],
            priceConfidence: 'untrusted',
            trustedPriceUSD: null,
            valueUSD: null,
            visibility: 'hidden',
        })
    })
})
