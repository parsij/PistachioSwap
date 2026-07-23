import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATIVE_TOKEN_ADDRESS } from '../src/lib/address.js'
import { ProviderError } from '../src/lib/errors.js'
import {
    MARKET_PROVIDER_BACKOFF_INITIAL_MS,
    createMarketCatalogService,
    createMarketTokenRoutes,
    filterEligibleVolumeTokens,
    type MarketDependencies,
    type MarketToken,
} from '../src/modules/market-tokens.js'
import type { CoinGeckoToken } from '../src/providers/coingecko/token-data.js'
import type { TokenMarket } from '../src/providers/dexscreener/token-markets.js'
import type { DiscoveredTokenCandidate } from '../src/providers/geckoterminal/top-pools.js'
import { hasMarketProviderCapability } from '../src/token-discovery/registry.js'

const NOW = Date.parse('2026-07-18T00:00:00.000Z')
const address = '0x0000000000000000000000000000000000000001'
const candidate: DiscoveredTokenCandidate = {
    address,
    name: 'Candidate',
    symbol: 'CAND',
    decimals: 18,
    imageUrl: 'https://coin-images.coingecko.com/candidate.png',
    priceUSD: '1',
    coinGeckoId: null,
    imageSource: 'geckoterminal',
}
const recognized: CoinGeckoToken = {
    ...candidate,
    coinGeckoId: 'candidate',
    imageSource: 'coingecko',
}
const market: TokenMarket = {
    address,
    name: 'Candidate',
    symbol: 'CAND',
    priceUSD: '1',
    volume24hUsd: 100_000,
    liquidityUsd: 500_000,
    pairCount: 1,
    pairUrl: 'https://dexscreener.com/bsc/pair',
    oldestPairCreatedAt: '2020-01-01T00:00:00.000Z',
}

function dependencies(overrides: Partial<MarketDependencies> = {}) {
    let now = NOW
    const values: Partial<MarketDependencies> & { advance(ms: number): void } = {
        discoverDexPaprika: async () => ({
            tokens: [], networkId: 'bsc', partial: false,
            malformedCount: 0, hasNextPage: false,
        }),
        discoverCandidates: async () => ({
            candidates: [candidate],
            pagesCompleted: 1,
            partial: false,
        }),
        fetchRecognized: async () => ({
            tokens: new Map([[address, recognized]]),
            partial: false,
            successfulBatches: 1,
            failedBatches: 0,
        }),
        fetchMarkets: async () => ({
            markets: new Map([[address, market]]),
            partial: false,
            successfulBatches: 1,
            failedBatches: 0,
        }),
        fetchMetadata: async () => new Map(),
        fetchDecimals: async () => new Map(),
        validateLogos: async (entries) => entries[0]
            ? {
                  logoURI: entries[0].url,
                  logoCandidates: entries.map((entry) => entry.url),
                  logoSource: entries[0].source,
              }
            : null,
        loadSnapshot: async () => null,
        saveSnapshot: async () => undefined,
        now: () => now,
        advance(ms: number) { now += ms },
        ...overrides,
    }
    return values
}

describe.sequential('market catalog reliability', () => {
    beforeEach(() => {
        process.env.ESTABLISHED_TOKEN_CACHE_TTL_MS = '10'
        process.env.ESTABLISHED_TOKEN_PARTIAL_RETRY_MS = '60000'
        process.env.ESTABLISHED_TOKEN_STALE_TTL_MS = '100'
        process.env.ESTABLISHED_TOKEN_MIN_LIQUIDITY_USD = '100000'
        process.env.ESTABLISHED_TOKEN_MIN_VOLUME_24H_USD = '25000'
        process.env.ESTABLISHED_TOKEN_MIN_POOL_AGE_DAYS = '30'
        process.env.ESTABLISHED_TOKEN_MIN_TXNS_24H = '0'
        process.env.ESTABLISHED_TOKEN_MIN_UNIQUE_TRADERS_24H = '0'
    })

    it('retains discovered candidates when DexScreener fails', async () => {
        const service = createMarketCatalogService(dependencies({
            fetchMarkets: async () => { throw new Error('Dex unavailable') },
        }))
        const { catalog } = await service.getCatalog(56)
        expect(catalog.tokens).toEqual([
            expect.objectContaining({
                address,
                volume24hUsd: null,
            }),
        ])
        expect(catalog.partial).toBe(true)
        expect(catalog.providerMetadata.unavailableProviders).toEqual([
            expect.objectContaining({ provider: 'dexscreener' }),
        ])
    })

    it('retains unverified market candidates when CoinGecko fails', async () => {
        const service = createMarketCatalogService(dependencies({
            fetchRecognized: async () => { throw new Error('CoinGecko unavailable') },
        }))
        const { catalog } = await service.getCatalog(56)
        expect(catalog.tokens).toEqual([
            expect.objectContaining({
                address,
                verificationStatus: 'unverified',
                volume24hUsd: 100_000,
            }),
        ])
        expect(catalog.partial).toBe(true)
    })

    it('keeps a candidate when optional metadata or logo validation is unavailable', async () => {
        const service = createMarketCatalogService(dependencies({
            fetchMetadata: async () => { throw new Error('metadata unavailable') },
            validateLogos: async () => { throw new Error('logo unavailable') },
        }))
        const { catalog } = await service.getCatalog(56)
        expect(catalog.tokens[0]).toMatchObject({
            address,
            verificationStatus: 'recognized',
        })
    })

    it('serves hard-stale last-known-good data after refresh failure', async () => {
        const deps = dependencies()
        let available = true
        deps.discoverCandidates = vi.fn(async () => {
            if (!available) throw new Error('discovery unavailable')
            return { candidates: [candidate], pagesCompleted: 1, partial: false }
        })
        const service = createMarketCatalogService(deps)
        const first = await service.getCatalog(56)
        deps.advance(101)
        available = false
        const hardStale = await service.getCatalog(56)
        expect(hardStale).toMatchObject({ stale: true, hardStale: true })
        expect(hardStale.catalog.tokens).toEqual(first.catalog.tokens)
        expect(deps.discoverCandidates).toHaveBeenCalledTimes(1)
        await service.refreshCatalog(56)
        expect(deps.discoverCandidates).toHaveBeenCalledTimes(2)
        expect((await service.getCatalog(56)).catalog.tokens)
            .toEqual(first.catalog.tokens)
    })

    it('returns HTTP 200 with fallback tokens on an uncached outage', async () => {
        const service = createMarketCatalogService(dependencies({
            discoverCandidates: async () => { throw new Error('unavailable') },
        }))
        const app = Fastify({ logger: false })
        await app.register(createMarketTokenRoutes(service))
        const response = await app.inject('/v1/market-tokens?chainId=56')
        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({
            partial: true,
            catalogUnavailable: true,
            count: 0,
            commonCount: 3,
            fallbackCount: 3,
            tokens: [],
            fallbackTokens: expect.arrayContaining([
                expect.objectContaining({ address: NATIVE_TOKEN_ADDRESS }),
                expect.objectContaining({
                    symbol: 'WBNB',
                    catalogSource: 'static-fallback',
                    directoryStatus: 'listed',
                }),
            ]),
        })
        await app.close()
    })

    it('serves curated OP tokens and honors Retry-After during a 429', async () => {
        const discover = vi.fn(async () => {
            throw new ProviderError({
                code: 'PROVIDER_RATE_LIMITED',
                message: 'Rate limited.',
                retryable: true,
                outcome: 'rate-limit',
                upstreamStatus: 429,
                retryAfterMs: 120_000,
            })
        })
        const service = createMarketCatalogService(dependencies({
            discoverCandidates: discover,
        }))
        const first = await service.refreshCatalog(10)
        const second = await service.refreshCatalog(10)

        expect(discover).toHaveBeenCalledOnce()
        expect(service.getProviderBackoffForTest(10, 'geckoterminal'))
            .toMatchObject({ nextAttemptAt: NOW + 120_000 })
        expect(first.commonTokens?.map((token) => token.symbol))
            .toEqual(expect.arrayContaining([
                'ETH', 'WETH', 'USDC', 'USDT', 'OP', 'DAI', 'WBTC',
            ]))
        expect(second.commonTokens).toEqual(first.commonTokens)
        expect(filterEligibleVolumeTokens(first.commonTokens ?? []).tokens)
            .toEqual([])
    })

    it('returns the OP fallback directory without starting a request-time refresh', async () => {
        let finishDiscovery!: () => void
        const discover = vi.fn(() => new Promise<{
            candidates: DiscoveredTokenCandidate[]
            pagesCompleted: number
            partial: boolean
        }>((resolve) => {
            finishDiscovery = () => resolve({
                candidates: [],
                pagesCompleted: 0,
                partial: true,
            })
        }))
        const service = createMarketCatalogService(dependencies({
            discoverCandidates: discover,
        }))
        const app = Fastify({ logger: false })
        await app.register(createMarketTokenRoutes(service))

        const response = await app.inject('/v1/market-tokens?chainId=10')
        expect(response.statusCode).toBe(200)
        expect(response.json().fallbackTokens.map((token: MarketToken) => token.symbol))
            .toEqual(expect.arrayContaining([
                'ETH', 'WETH', 'USDC', 'USDT', 'OP', 'DAI', 'WBTC',
            ]))
        expect(discover).not.toHaveBeenCalled()

        const refresh = service.refreshCatalog(10)
        await vi.waitFor(() => expect(discover).toHaveBeenCalledOnce())
        finishDiscovery()
        await refresh
        await app.close()
    })

    it('backs off repeated provider failures and resets after success', async () => {
        const deps = dependencies()
        let available = false
        deps.discoverCandidates = vi.fn(async () => {
            if (!available) throw new Error('unavailable')
            return { candidates: [candidate], pagesCompleted: 1, partial: false }
        })
        const service = createMarketCatalogService(deps)
        await service.refreshCatalog(56)
        await service.refreshCatalog(56)
        expect(deps.discoverCandidates).toHaveBeenCalledTimes(1)
        expect(service.getProviderBackoffForTest(56, 'geckoterminal'))
            .toMatchObject({ nextAttemptAt: NOW + MARKET_PROVIDER_BACKOFF_INITIAL_MS })

        deps.advance(MARKET_PROVIDER_BACKOFF_INITIAL_MS + 1)
        available = true
        await service.refreshCatalog(56)
        expect(deps.discoverCandidates).toHaveBeenCalledTimes(2)
        expect(service.getProviderBackoffForTest(56, 'geckoterminal')).toBeNull()
        await service.refreshCatalog(56)
        expect(deps.discoverCandidates).toHaveBeenCalledTimes(3)
    })

    it('does not apply retry backoff to invalid provider configuration', async () => {
        const discover = vi.fn(async () => {
            throw new ProviderError({
                code: 'PROVIDER_NOT_CONFIGURED',
                message: 'Provider is not configured.',
                statusCode: 503,
                outcome: 'configuration',
            })
        })
        const service = createMarketCatalogService(dependencies({
            discoverCandidates: discover,
        }))
        await service.refreshCatalog(56)
        await service.refreshCatalog(56)
        expect(discover).toHaveBeenCalledTimes(2)
        expect(service.getProviderBackoffForTest(56, 'geckoterminal')).toBeNull()
    })

    it('deduplicates concurrent refreshes and gates unsupported capabilities', async () => {
        let resolveDiscovery!: (value: {
            candidates: DiscoveredTokenCandidate[]
            pagesCompleted: number
            partial: boolean
        }) => void
        const discover = vi.fn(() => new Promise<{
            candidates: DiscoveredTokenCandidate[]
            pagesCompleted: number
            partial: boolean
        }>((resolve) => { resolveDiscovery = resolve }))
        const service = createMarketCatalogService(dependencies({
            discoverCandidates: discover,
        }))
        const first = service.refreshCatalog(56)
        const second = service.refreshCatalog(56)
        await vi.waitFor(() => expect(discover).toHaveBeenCalledOnce())
        resolveDiscovery({ candidates: [candidate], pagesCompleted: 1, partial: false })
        await Promise.all([first, second])
        expect(discover).toHaveBeenCalledOnce()

        const outbound = vi.fn()
        if (hasMarketProviderCapability(1101, 'geckoterminal')) await outbound()
        expect(outbound).not.toHaveBeenCalled()
    })
})
