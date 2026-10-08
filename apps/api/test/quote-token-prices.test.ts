import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeDexPair } from '../src/providers/dexscreener/dexscreener-client.js'
import { aggregateTokenMarkets, fetchTokenMarkets } from '../src/providers/dexscreener/token-markets.js'
import { ACTIVE_TOKEN_DISCOVERY_CHAINS } from '../src/token-discovery/registry.js'

const base = '0x1111111111111111111111111111111111111111'
const quote = '0x2222222222222222222222222222222222222222'
function pair(chainId = 'ethereum', priceNative: unknown = '2500', priceUsd = '2495') {
    return {
        chainId, pairAddress: '0x3333333333333333333333333333333333333333',
        baseToken: { address: base, name: 'Ether', symbol: 'ETH' },
        quoteToken: { address: quote, name: 'USD Coin', symbol: 'USDC' },
        priceNative, priceUsd, liquidity: { usd: 1000000 },
    }
}

describe('quote-side token USD prices', () => {
    afterEach(() => vi.unstubAllGlobals())
    it('prices both assets from the pair and preserves a stablecoin depeg', () => {
        const normalized = normalizeDexPair(pair())!
        expect(normalized.priceNative).toBe('2500')
        const prices = aggregateTokenMarkets([normalized])
        expect(prices.get(base)?.priceUSD).toBe('2495')
        expect(prices.get(quote)?.priceUSD).toBe('0.998')
    })
    it.each([null, undefined, '0', '0.0', '-1', 'NaN', 'Infinity', '1e-8'])('never invents $1 when the ratio is invalid: %s', priceNative => {
        const prices = aggregateTokenMarkets([normalizeDexPair({ ...pair(), priceNative })!])
        expect(prices.get(quote)?.priceUSD).toBeNull()
    })
    it('selects the deepest liquid pool and ignores duplicate pools', () => {
        const liquid = normalizeDexPair(pair())!
        const thin = { ...liquid, pairAddress: base, priceUsd: '100', liquidityUsd: 1 }
        expect(aggregateTokenMarkets([thin, liquid, liquid]).get(quote)).toMatchObject({ priceUSD: '0.998', pairCount: 2 })
    })
    it.each(ACTIVE_TOKEN_DISCOVERY_CHAINS.filter(chain => chain.capabilities.dexScreener))('prices quote-side stablecoins on $name using only that network', async chain => {
        const provider = chain.providers.dexScreenerChain
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
            pair(provider), pair('wrong-network', '1', '999'),
        ]))))
        const result = await fetchTokenMarkets([quote], undefined, chain.chainId)
        expect(result.markets.get(quote)?.priceUSD).toBe('0.998')
    })
})
