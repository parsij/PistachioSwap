import { describe, expect, it } from 'vitest'

import { sendTokenMatchesSearch } from './sendTokenSearch.js'

const usdc = {
    chainId: 137,
    address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    name: 'USD Coin',
    symbol: 'USDC',
    searchAliases: ['circle usd'],
}

describe('Send token search', () => {
    it('matches from the first character', () => {
        expect(sendTokenMatchesSearch(usdc, 'u')).toBe(true)
        expect(sendTokenMatchesSearch(usdc, 'c')).toBe(true)
    })

    it('matches names, symbols, aliases, and partial addresses locally', () => {
        expect(sendTokenMatchesSearch(usdc, 'coin')).toBe(true)
        expect(sendTokenMatchesSearch(usdc, 'circle')).toBe(true)
        expect(sendTokenMatchesSearch(usdc, '0x3c49')).toBe(true)
        expect(sendTokenMatchesSearch(usdc, 'banana')).toBe(false)
    })
})
