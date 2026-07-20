import { describe, expect, it } from 'vitest'

import {
    getOfficialAsset,
    mergeCuratedTokenList,
} from '../src/providers/recognition/curated-token-lists.js'

const recognized = '0x0000000000000000000000000000000000000011'
const impersonator = '0x0000000000000000000000000000000000000022'

describe('curated exact-address recognition', () => {
    const xaut = '0x21caef8a43163eea865baee23b9c2e327696a3bf'

    it('matches official BNB Tether Gold only by exact chain and contract', () => {
        expect(getOfficialAsset(56, xaut)).toMatchObject({
            chainId: 56,
            address: xaut,
            name: 'Tether Gold',
            symbol: 'XAUt',
            decimals: 6,
            recognitionStatus: 'established',
            verifiedContract: true,
            officialAsset: true,
            logoURI: '/icons/tether-gold.png',
        })
        expect(getOfficialAsset(1, xaut)).toBeNull()
        expect(getOfficialAsset(56, impersonator)).toBeNull()

    })

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
            officialAsset: null,
        })
        expect(values.has(impersonator)).toBe(false)
    })

    it('recognizes the curated OP baseline only by exact contracts', () => {
        expect(getOfficialAsset(
            10,
            '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
        )).toMatchObject({ symbol: 'USDC', decimals: 6, verifiedContract: true })
        expect(getOfficialAsset(
            10,
            '0x4200000000000000000000000000000000000042',
        )).toMatchObject({ symbol: 'OP', decimals: 18, verifiedContract: true })
        expect(getOfficialAsset(1, '0x4200000000000000000000000000000000000042'))
            .toBeNull()
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
