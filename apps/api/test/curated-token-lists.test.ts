import { describe, expect, it } from 'vitest'

import {
    mergeCuratedTokenList,
} from '../src/providers/recognition/curated-token-lists.js'

const recognized = '0x0000000000000000000000000000000000000011'
const impersonator = '0x0000000000000000000000000000000000000022'

describe('curated exact-address recognition', () => {
    it('does not transfer list membership between contracts sharing a symbol', () => {
        const values = new Map()
        mergeCuratedTokenList(values, {
            tokens: [{
                chainId: 56,
                address: recognized.toUpperCase(),
                symbol: 'USDT',
                name: 'Reviewed token',
            }],
        }, 'pancakeSwap')

        expect(values.get(recognized)).toEqual({
            pancakeSwap: true,
            trustWallet: false,
        })
        expect(values.has(impersonator)).toBe(false)
    })

    it('rejects another chain even when the address is syntactically valid', () => {
        const values = new Map()
        mergeCuratedTokenList(values, [{
            chainId: 1,
            address: recognized,
        }], 'trustWallet')

        expect(values.size).toBe(0)
    })
})
