import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchDexPaprikaMarketTokens, parseDexPaprikaToken } from '../src/providers/dexpaprika/market-tokens.js'
import { DEXPAPRIKA_NETWORK_BY_CHAIN_ID, getDexPaprikaNetworkId } from '../src/providers/dexpaprika/networks.js'

const token = {
    chain: 'optimism', address: '0x0000000000000000000000000000000000000001',
    price_usd: 1, price_change_percentage_24h: 2, volume_usd_24h: 1_000_000,
    volume_usd_7d: 7_000_000, volume_usd_30d: 30_000_000,
    liquidity_usd: 500_000, fdv_usd: 100_000_000, txns_24h: 1000,
    created_at: '2020-01-01T00:00:00.000Z', name: 'USD Coin', symbol: 'USDC',
    decimals: 6, has_image: true, pools: 20,
}

describe('DexPaprika market discovery', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('uses the current token search contract and clamps limit', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            results: [token], has_next_page: false, next_cursor: null,
        }), { status: 200, headers: { 'content-type': 'application/json' } }))
        vi.stubGlobal('fetch', fetchMock)
        const result = await fetchDexPaprikaMarketTokens({
            chainId: 10, limit: 999, liquidityMinimumUsd: 100_000,
            transactionMinimum24h: 50,
        })
        const url = new URL(fetchMock.mock.calls[0][0] as URL)
        expect(url.pathname).toBe('/networks/optimism/tokens/search')
        expect(url.pathname).not.toContain('/tokens/top')
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
            limit: '100', order_by: 'volume_usd_24h', sort: 'desc',
            liquidity_usd_min: '100000', txns_24h_min: '50', detailed: 'true',
        })
        expect(result.tokens[0]).toMatchObject({
            provider: 'dexpaprika', recognitionStatus: 'unverified',
            verifiedContract: false, marketPriceUSD: '1', logoURI: null,
            logoCandidates: [], hasProviderImage: true,
        })
    })

    it('rejects malformed records individually', () => {
        expect(parseDexPaprikaToken({ ...token, address: 'bad' }, 10, 'optimism')).toBeNull()
        expect(parseDexPaprikaToken({ ...token, volume_usd_24h: -1 }, 10, 'optimism')).toBeNull()
        expect(parseDexPaprikaToken({ ...token, txns_24h: Number.NaN }, 10, 'optimism')).toBeNull()
        expect(parseDexPaprikaToken(token, 10, 'optimism')?.address)
            .toBe('0x0000000000000000000000000000000000000001')
    })

    it('uses an explicit mapping and makes no request for unsupported chains', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        expect(getDexPaprikaNetworkId(100)).toBeNull()
        await expect(fetchDexPaprikaMarketTokens({
            chainId: 100, liquidityMinimumUsd: 1, transactionMinimum24h: 1,
        })).rejects.toThrow(/does not support/)
        expect(fetchMock).not.toHaveBeenCalled()
        expect(DEXPAPRIKA_NETWORK_BY_CHAIN_ID[56]).toBe('bsc')
    })
})
