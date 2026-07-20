import { describe, expect, it } from 'vitest'

import {
    getDisplayTokenPrice,
    getTrustedTokenPrice,
} from './tokenPrices.js'

const recognizedUsdt = {
    chainId: 56,
    address: '0x55d398326f99059ff775485246999027b3197955',
    recognitionStatus: 'established',
    possibleSpam: false,
    securityStatus: 'trusted',
    visibility: 'primary',
    priceConfidence: 'market',
    trustedPriceUSD: null,
    marketPriceUSD: '0.9998',
    priceUSD: '0.9997',
}

describe('token price selection', () => {
    it('uses safe recognized market pricing for display only', () => {
        expect(getDisplayTokenPrice(recognizedUsdt)).toBe('0.9998')
        expect(getTrustedTokenPrice(recognizedUsdt)).toBeNull()
        expect(recognizedUsdt.trustedPriceUSD).toBeNull()
    })

    it('prefers trusted display pricing without weakening the trusted helper', () => {
        expect(getDisplayTokenPrice({
            ...recognizedUsdt,
            priceConfidence: 'trusted',
            trustedPriceUSD: '1.01',
        })).toBe('1.01')
    })

    it.each([
        { recognitionStatus: 'unverified' },
        { possibleSpam: true },
        { visibility: 'hidden' },
        { securityStatus: 'blocked' },
        { securityStatus: 'high' },
    ])('rejects unsafe display pricing for %o', (override) => {
        expect(getDisplayTokenPrice({ ...recognizedUsdt, ...override })).toBeNull()
    })
})
