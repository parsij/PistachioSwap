import { describe, expect, it } from 'vitest'

import { tokenMatchesSearch } from './tokenSelectorState.js'

describe('tokenMatchesSearch scoped query interpretation', () => {
    const polygonPol = {
        chainId: 137,
        address: '0x0000000000000000000000000000000000000000',
        name: 'POL',
        symbol: 'POL',
    }
    const bnbMatic = {
        chainId: 56,
        address: '0x1111111111111111111111111111111111111111',
        name: 'Matic Token',
        symbol: 'MATIC',
    }
    const polygonUsdc = {
        chainId: 137,
        address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
        name: 'USD Coin',
        symbol: 'USDC',
    }
    const ethereumUsdc = {
        chainId: 1,
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        name: 'USD Coin',
        symbol: 'USDC',
    }

    it('does not apply the Polygon MATIC-to-POL rewrite inside an explicit BNB scope', () => {
        expect(tokenMatchesSearch(bnbMatic, 'matic', 56)).toBe(true)
        expect(tokenMatchesSearch(polygonPol, 'matic', 56)).toBe(false)
    })

    it('still applies MATIC-to-POL when the searched token is on Polygon', () => {
        expect(tokenMatchesSearch(polygonPol, 'matic', 'all')).toBe(true)
        expect(tokenMatchesSearch(polygonPol, 'matic')).toBe(true)
    })

    it('keeps compound network qualifiers chain-specific in all-network search', () => {
        expect(tokenMatchesSearch(polygonUsdc, 'usdc polygon', 'all')).toBe(true)
        expect(tokenMatchesSearch(ethereumUsdc, 'usdc polygon', 'all')).toBe(false)
    })

    it('uses the token chain as the safe fallback scope when a caller omits scope', () => {
        expect(tokenMatchesSearch(bnbMatic, 'matic')).toBe(true)
    })
})
