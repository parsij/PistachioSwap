import { describe, expect, it, vi } from 'vitest'

import { tokenPriceInternals } from '../src/providers/alchemy/token-prices.js'

const { normalizeUsdPrice, resolveNativePriceSources } = tokenPriceInternals

describe('provider USD price normalization', () => {
    it('keeps values that already fit USD micros', () => {
        expect(normalizeUsdPrice('4187.123456')).toBe('4187.123456')
        expect(normalizeUsdPrice('4187.12')).toBe('4187.12')
        expect(normalizeUsdPrice('4187')).toBe('4187')
    })

    it('rounds provider values with more than six decimal places', () => {
        expect(normalizeUsdPrice('4187.1234564')).toBe('4187.123456')
        expect(normalizeUsdPrice('4187.1234565')).toBe('4187.123457')
        expect(normalizeUsdPrice('0.9999999')).toBe('1')
    })

    it('rejects invalid provider values without using floating point math', () => {
        expect(normalizeUsdPrice('-1')).toBeNull()
        expect(normalizeUsdPrice('1e3')).toBeNull()
        expect(normalizeUsdPrice('not-a-price')).toBeNull()
    })
})

describe('trusted native price fallback', () => {
    it('uses Moralis wrapped-native pricing when Alchemy has no usable native price', async () => {
        const alchemy = vi.fn().mockResolvedValue(null)
        const moralis = vi.fn().mockResolvedValue('742.123456')
        const coinGecko = vi.fn().mockResolvedValue('743.000000')

        await expect(resolveNativePriceSources(56, [
            { provider: 'alchemy', load: alchemy },
            { provider: 'moralis', load: moralis },
            { provider: 'coingecko', load: coinGecko },
        ])).resolves.toEqual({
            value: '742.123456',
            provider: 'moralis',
        })

        expect(alchemy).toHaveBeenCalledTimes(1)
        expect(moralis).toHaveBeenCalledTimes(1)
        expect(coinGecko).not.toHaveBeenCalled()
    })

    it('continues after provider errors and uses CoinGecko as the final fallback', async () => {
        const alchemy = vi.fn().mockRejectedValue(new Error('alchemy unavailable'))
        const moralis = vi.fn().mockResolvedValue(null)
        const coinGecko = vi.fn().mockResolvedValue('744.5')

        await expect(resolveNativePriceSources(56, [
            { provider: 'alchemy', load: alchemy },
            { provider: 'moralis', load: moralis },
            { provider: 'coingecko', load: coinGecko },
        ])).resolves.toEqual({
            value: '744.5',
            provider: 'coingecko',
        })
    })

    it('returns null only after every trusted provider fails or returns no price', async () => {
        await expect(resolveNativePriceSources(56, [
            { provider: 'alchemy', load: async () => null },
            { provider: 'moralis', load: async () => null },
            { provider: 'coingecko', load: async () => null },
        ])).resolves.toBeNull()
    })
})
