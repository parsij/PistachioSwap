import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getApiConfig } from '../src/config.js'
import { NATIVE_TOKEN_ADDRESS } from '../src/lib/address.js'
import {
    type MarketDependencies,
    type MarketToken,
    createMarketCatalogService,
    createMarketTokenRoutes,
} from '../src/modules/market-tokens.js'
import {
    type CoinGeckoToken,
    getCoinGeckoTokensBatch,
    normalizeCoinGeckoToken,
} from '../src/providers/coingecko/token-data.js'
import {
    type TokenMarket,
    aggregateTokenMarkets,
    fetchTokenMarkets,
} from '../src/providers/dexscreener/token-markets.js'
import type { DexPair } from '../src/providers/dexscreener/dexscreener-client.js'
import {
    type DiscoveredTokenCandidate,
    discoverTopPoolTokens,
} from '../src/providers/geckoterminal/top-pools.js'
import { validateRemoteLogoUrl } from '../src/providers/logo-validator.js'

const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
const NOW = Date.parse('2026-07-13T00:00:00.000Z')
const OLD_POOL = Date.parse('2020-01-01T00:00:00.000Z')
const NEW_POOL = Date.parse('2026-07-01T00:00:00.000Z')
const address = (index: number) =>
    `0x${index.toString(16).padStart(40, '0')}`

function candidate(
    index: number,
    overrides: Partial<DiscoveredTokenCandidate> = {},
): DiscoveredTokenCandidate {
    return {
        address: address(index),
        name: `Discovered ${index}`,
        symbol: `D${index}`,
        decimals: 18,
        imageUrl: null,
        priceUSD: String(index),
        coinGeckoId: null,
        imageSource: 'geckoterminal',
        ...overrides,
    }
}

function recognized(
    index: number,
    overrides: Partial<CoinGeckoToken> = {},
): CoinGeckoToken {
    return {
        address: address(index),
        name: `Recognized ${index}`,
        symbol: `R${index}`,
        decimals: 18,
        imageUrl: `https://coin-images.coingecko.com/token-${index}.png`,
        coinGeckoId: `recognized-${index}`,
        priceUSD: String(index),
        imageSource: 'coingecko',
        ...overrides,
    }
}

function market(
    index: number,
    overrides: Partial<TokenMarket> = {},
): TokenMarket {
    return {
        address: address(index),
        name: `Market ${index}`,
        symbol: `M${index}`,
        priceUSD: String(index),
        volume24hUsd: 50_000 + index,
        liquidityUsd: 200_000 + index,
        pairCount: 1,
        pairUrl: `https://dexscreener.com/bsc/${address(5_000 + index)}`,
        oldestPairCreatedAt: new Date(OLD_POOL).toISOString(),
        ...overrides,
    }
}

function validLogo(entries: Array<{ url: string; source: string }>) {
    const first = entries[0]
    return Promise.resolve(
        first
            ? {
                  logoURI: first.url,
                  logoCandidates: entries.map((entry) => entry.url),
                  logoSource: first.source,
              }
            : null,
    )
}

function serviceFor(
    candidates: DiscoveredTokenCandidate[],
    overrides: Partial<MarketDependencies> = {},
) {
    const recognition = new Map(
        candidates.map((value, index) => [
            value.address,
            recognized(index + 1, {
                address: value.address,
                symbol: value.symbol,
            }),
        ]),
    )
    const markets = new Map(
        candidates.map((value, index) => [
            value.address,
            market(index + 1, { address: value.address }),
        ]),
    )

    return createMarketCatalogService({
        discoverCandidates: async () => ({
            candidates,
            pagesCompleted: 3,
            partial: false,
        }),
        fetchRecognized: async () => ({
            tokens: recognition,
            partial: false,
            successfulBatches: 1,
            failedBatches: 0,
        }),
        fetchMarkets: async () => ({
            markets,
            partial: false,
            successfulBatches: 1,
            failedBatches: 0,
        }),
        validateLogos: validLogo as MarketDependencies['validateLogos'],
        loadSnapshot: async () => null,
        saveSnapshot: async () => undefined,
        now: () => NOW,
        ...overrides,
    })
}

async function inject(
    service: ReturnType<typeof createMarketCatalogService>,
    url: string,
) {
    const app = Fastify()
    await app.register(createMarketTokenRoutes(service))
    try {
        return await app.inject({ method: 'GET', url })
    } finally {
        await app.close()
    }
}

function pair(overrides: Partial<DexPair> = {}): DexPair {
    return {
        chainId: 'bsc',
        dexId: 'pancakeswap',
        pairAddress: address(9_000),
        url: 'https://dexscreener.com/bsc/pair',
        baseToken: { address: address(1), name: 'One', symbol: 'ONE' },
        quoteToken: { address: address(2), name: 'Two', symbol: 'TWO' },
        priceUsd: '2',
        volume24hUsd: 1_000,
        liquidityUsd: 4_000,
        pairCreatedAt: OLD_POOL,
        ...overrides,
    }
}

describe.sequential('established BSC market catalog', () => {
    const previousEnv = { ...process.env }

    beforeEach(() => {
        delete process.env.ALCHEMY_API_KEY
        delete process.env.ALCHEMY_BSC_RPC_URL
        delete process.env.BSC_RPC_URL
        process.env.COINGECKO_DEMO_API_KEY = 'test-key'
        process.env.COINGECKO_API_BASE_URL = 'http://localhost:9998'
        process.env.COINGECKO_NETWORK_56 = 'bsc'
        process.env.PANCAKESWAP_WRAPPED_NATIVE_ADDRESS_56 = WBNB
        process.env.ESTABLISHED_TOKEN_MIN_LIQUIDITY_USD = '100000'
        process.env.ESTABLISHED_TOKEN_MIN_VOLUME_24H_USD = '25000'
        process.env.ESTABLISHED_TOKEN_MIN_POOL_AGE_DAYS = '30'
        process.env.ESTABLISHED_TOKEN_MIN_PAIR_COUNT = '1'
        process.env.ESTABLISHED_TOKEN_LIMIT = '100'
        process.env.ESTABLISHED_CANDIDATE_LIMIT = '250'
        process.env.ESTABLISHED_TOKEN_CACHE_TTL_MS = '10'
        process.env.ESTABLISHED_TOKEN_PARTIAL_RETRY_MS = '60000'
        process.env.ESTABLISHED_TOKEN_STALE_TTL_MS = '86400000'
        process.env.ESTABLISHED_TOKEN_SNAPSHOT_ENABLED = 'false'
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        process.env = { ...previousEnv }
    })

    it('requires an exact CoinGecko BSC contract match', async () => {
        const discovered = candidate(1, { symbol: 'MATCH' })
        const service = serviceFor([discovered], {
            fetchRecognized: async () => ({
                tokens: new Map([
                    [address(2), recognized(2, { symbol: 'MATCH' })],
                ]),
                partial: false,
                successfulBatches: 1,
                failedBatches: 0,
            }),
        })
        await expect(service.getCatalog()).rejects.toMatchObject({
            code: 'MARKET_CATALOG_EMPTY',
        })
    })

    it('uses exact GeckoTerminal CoinGecko metadata when the CoinGecko API is unavailable', async () => {
        const discovered = candidate(1, {
            coinGeckoId: 'celo-token',
            imageUrl: 'https://coin-images.coingecko.com/celo-token.png',
        })
        const service = serviceFor([discovered], {
            fetchRecognized: async () => {
                throw new Error('CoinGecko API is not configured.')
            },
        })

        const { catalog } = await service.getCatalog(42220)
        expect(catalog.partial).toBe(true)
        expect(catalog.tokens).toEqual([
            expect.objectContaining({
                chainId: 42220,
                address: discovered.address,
                coinGeckoId: 'celo-token',
                verificationStatus: 'established',
            }),
        ])
    })

    it('rejects symbol-only CoinGecko matches', () => {
        const parsed = normalizeCoinGeckoToken(
            {
                id: `bsc_${address(2)}`,
                type: 'token',
                attributes: {
                    address: address(1),
                    name: 'Same name',
                    symbol: 'SAME',
                    decimals: 18,
                    coingecko_coin_id: 'same-symbol',
                },
            },
            'bsc',
        )
        expect(parsed).toBeNull()
    })

    it.each([
        ['below-liquidity-threshold', { liquidityUsd: 99_999 }],
        ['below-volume-threshold', { volume24hUsd: 24_999 }],
        [
            'pool-too-new-or-age-unavailable',
            { oldestPairCreatedAt: new Date(NEW_POOL).toISOString() },
        ],
    ])('excludes tokens for %s', async (reason, marketOverride) => {
        const value = candidate(1)
        const service = serviceFor([value], {
            fetchMarkets: async () => ({
                markets: new Map([
                    [value.address, market(1, marketOverride)],
                ]),
                partial: false,
                successfulBatches: 1,
                failedBatches: 0,
            }),
        })
        await expect(service.getCatalog()).rejects.toMatchObject({
            code: 'MARKET_CATALOG_EMPTY',
        })
    })

    it('excludes default tokens without a validated real image', async () => {
        const service = serviceFor([candidate(1)], {
            validateLogos: async () => null,
        })
        await expect(service.getCatalog()).rejects.toMatchObject({
            code: 'MARKET_CATALOG_EMPTY',
        })
    })

    it('does not exclude a text-search token when its real image is missing', async () => {
        const token = recognized(1, { imageUrl: null, symbol: 'USDT' })
        const service = serviceFor([], {
            searchCandidates: async () => [token],
            fetchMarkets: async () => ({
                markets: new Map(),
                partial: false,
                successfulBatches: 1,
                failedBatches: 0,
            }),
        })
        const response = await inject(service, '/v1/market-tokens?q=usdt')
        expect(response.statusCode).toBe(200)
        expect(response.json().tokens).toHaveLength(1)
        expect(response.json().tokens[0].verificationStatus).toBe('recognized')
    })

    it('never assigns pair artwork to either token and counts duplicate pairs once', () => {
        const marketMap = aggregateTokenMarkets([
            { ...pair(), imageUrl: 'https://example.com/pair.png' } as DexPair,
            pair(),
        ])
        expect(marketMap.get(address(1))).toMatchObject({
            volume24hUsd: 500,
            liquidityUsd: 4_000,
            pairCount: 1,
        })
        expect(marketMap.get(address(2))).toMatchObject({
            volume24hUsd: 500,
            liquidityUsd: 4_000,
            pairCount: 1,
        })
        expect(marketMap.get(address(1))).not.toHaveProperty('imageUrl')
        expect(marketMap.get(address(2))).not.toHaveProperty('imageUrl')
    })

    it('deduplicates contracts and allows fewer than 100 qualifying tokens', async () => {
        const duplicate = candidate(1)
        const { catalog } = await serviceFor([duplicate, duplicate]).getCatalog()
        expect(catalog.tokens).toHaveLength(1)
        expect(new Set(catalog.tokens.map((token) => token.address)).size).toBe(1)
    })

    it('keeps WBNB and allowlisted native BNB as distinct assets', async () => {
        const wrapped = candidate(1, {
            address: WBNB,
            name: 'Wrapped BNB',
            symbol: 'WBNB',
        })
        const { catalog } = await serviceFor([wrapped], {
            fetchRecognized: async () => ({
                tokens: new Map([
                    [
                        WBNB,
                        recognized(1, {
                            address: WBNB,
                            name: 'Wrapped BNB',
                            symbol: 'WBNB',
                            coinGeckoId: 'wbnb',
                        }),
                    ],
                ]),
                partial: false,
                successfulBatches: 1,
                failedBatches: 0,
            }),
        }).getCatalog()
        expect(catalog.tokens.map((token) => token.address)).toEqual(
            expect.arrayContaining([WBNB, NATIVE_TOKEN_ADDRESS]),
        )
        expect(catalog.tokens.find((token) => token.address === WBNB)?.symbol).toBe(
            'WBNB',
        )
        expect(
            catalog.tokens.find((token) => token.address === NATIVE_TOKEN_ADDRESS)
                ?.symbol,
        ).toBe('BNB')
    })

    it('ranks canonical native BNB first for an exact BNB search', async () => {
        const response = await inject(
            serviceFor([], {
                searchCandidates: async () => [],
                searchMarkets: async () => [],
            }),
            '/v1/market-tokens?chainId=56&q=bnb',
        )
        expect(response.statusCode).toBe(200)
        expect(response.json().tokens[0]).toMatchObject({
            address: NATIVE_TOKEN_ADDRESS,
            symbol: 'BNB',
            isNative: true,
        })
    })

    it('sorts by BSC 24-hour volume and never exceeds 100', async () => {
        const candidates = Array.from({ length: 120 }, (_, index) =>
            candidate(index + 1),
        )
        const markets = new Map(
            candidates.map((value, index) => [
                value.address,
                market(index + 1, {
                    address: value.address,
                    volume24hUsd: 30_000 + index,
                }),
            ]),
        )
        const { catalog } = await serviceFor(candidates, {
            fetchMarkets: async () => ({
                markets,
                partial: false,
                successfulBatches: 4,
                failedBatches: 0,
            }),
        }).getCatalog()
        expect(catalog.tokens).toHaveLength(100)
        expect(catalog.tokens[0].volume24hUsd).toBe(30_119)
        expect(catalog.tokens.every((token) => token.verificationStatus === 'established')).toBe(true)
    })

    it('builds one hourly-ready combined catalog capped at 200 tokens', async () => {
        const service = serviceFor([
            candidate(1),
            candidate(2),
            candidate(3),
        ])
        const combined = await service.refreshAllCatalogs()
        const chainCounts = new Map<number, number>()
        for (const token of combined.tokens) {
            chainCounts.set(
                token.chainId,
                (chainCounts.get(token.chainId) ?? 0) + 1,
            )
        }

        expect(combined.tokens.length).toBeLessThanOrEqual(200)
        expect([...chainCounts.values()].every((count) => count <= 100))
            .toBe(true)
        expect(combined.tokens.every((token) =>
            token.logoURI && token.volume24hUsd > 0,
        )).toBe(true)
        expect(combined.tokens.map((token) => token.volume24hUsd))
            .toEqual([...combined.tokens]
                .map((token) => token.volume24hUsd)
                .sort((left, right) => right - left))
    })

    it('preserves completed GeckoTerminal pages after later rate limiting', async () => {
        process.env.GECKOTERMINAL_PAGE_DELAY_MS = '0'
        const payload = {
            data: [
                {
                    relationships: {
                        base_token: { data: { id: `bsc_${address(1)}` } },
                        quote_token: { data: { id: `bsc_${address(2)}` } },
                    },
                    attributes: {},
                },
            ],
            included: [],
        }
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(JSON.stringify(payload), { status: 200 }),
            )
            .mockResolvedValueOnce(new Response('{}', { status: 429 }))
        vi.stubGlobal('fetch', fetchMock)

        const result = await discoverTopPoolTokens({ minimumCandidates: 3 })
        expect(result.candidates.map((token) => token.address)).toEqual([
            address(1),
            address(2),
        ])
        expect(result.partial).toBe(true)
        expect(result.pagesCompleted).toBe(1)
    })

    it('preserves successful DexScreener batches when a later batch fails', async () => {
        const addresses = Array.from({ length: 31 }, (_, index) => address(index + 1))
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input) => {
                const url = String(input)
                if (url.includes(address(31))) {
                    return new Response('{}', { status: 500 })
                }
                return new Response(
                    JSON.stringify([
                        {
                            chainId: 'bsc',
                            dexId: 'pancakeswap',
                            pairAddress: address(9_000),
                            url: 'https://dexscreener.com/bsc/pair',
                            baseToken: {
                                address: address(1),
                                name: 'One',
                                symbol: 'ONE',
                            },
                            quoteToken: {
                                address: address(2),
                                name: 'Two',
                                symbol: 'TWO',
                            },
                            priceUsd: '1',
                            volume: { h24: 100_000 },
                            liquidity: { usd: 300_000 },
                            pairCreatedAt: OLD_POOL,
                        },
                    ]),
                    { status: 200 },
                )
            }),
        )
        const result = await fetchTokenMarkets(addresses)
        expect(result.partial).toBe(true)
        expect(result.successfulBatches).toBe(1)
        expect(result.failedBatches).toBe(1)
        expect(result.markets.has(address(1))).toBe(true)
    })

    it('keeps the previous catalog after a failed refresh', async () => {
        let now = NOW
        let available = true
        const base = candidate(1)
        const service = serviceFor([base], {
            now: () => now,
            discoverCandidates: async () => {
                if (!available) throw new Error('Gecko unavailable')
                return { candidates: [base], pagesCompleted: 1, partial: false }
            },
        })
        const first = await service.getCatalog()
        now += 11
        available = false
        const stale = await service.getCatalog()
        expect(stale.stale).toBe(true)
        expect(stale.catalog.tokens).toEqual(first.catalog.tokens)
        await expect(service.refreshCatalog()).rejects.toThrow(
            'Gecko unavailable',
        )
        const retained = await service.getCatalog()
        expect(retained.catalog.tokens).toEqual(first.catalog.tokens)
    })

    it('retries an initial partial catalog after one minute', async () => {
        let now = NOW
        const discover = vi.fn(async () => ({
            candidates: [candidate(1)],
            pagesCompleted: 1,
            partial: true,
        }))
        const service = serviceFor([candidate(1)], {
            now: () => now,
            discoverCandidates: discover,
        })
        await service.getCatalog()
        now += 59_999
        await service.getCatalog()
        expect(discover).toHaveBeenCalledTimes(1)
        now += 2
        const stale = await service.getCatalog()
        expect(stale.stale).toBe(true)
        await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(2))
        await service.getCatalog()
        expect(discover).toHaveBeenCalledTimes(2)
    })

    it('returns at most 20 broader text-search results with recognized results first', async () => {
        const values = Array.from({ length: 25 }, (_, index) =>
            recognized(index + 1, { symbol: index === 24 ? 'QUERY' : `QUERY${index}` }),
        )
        const service = serviceFor([], {
            searchCandidates: async () => values,
            fetchMarkets: async () => ({
                markets: new Map(),
                partial: false,
                successfulBatches: 1,
                failedBatches: 0,
            }),
        })
        const response = await inject(service, '/v1/market-tokens?q=query&limit=20')
        expect(response.statusCode).toBe(200)
        expect(response.json().tokens).toHaveLength(20)
        expect(
            response.json().tokens.every(
                (token: MarketToken) => token.verificationStatus === 'recognized',
            ),
        ).toBe(true)
    })

    it('keeps an exact-address unverified token searchable', async () => {
        const exact = address(777)
        const service = serviceFor([], {
            fetchTokenInfo: async () => null,
            searchMarkets: async () => [
                market(777, {
                    address: exact,
                    name: 'Lesser Known',
                    symbol: 'LESS',
                }),
            ],
            fetchDecimals: async () => new Map([[exact, 9]]),
        })
        const response = await inject(
            service,
            `/v1/market-tokens?q=${exact}&limit=20`,
        )
        expect(response.statusCode).toBe(200)
        expect(response.json().tokens[0]).toMatchObject({
            address: exact,
            decimals: 9,
            verificationStatus: 'unverified',
        })
    })

    it('never overwrites the last snapshot with a partial provider refresh', async () => {
        let now = NOW
        let partial = false
        const saveSnapshot = vi.fn(async () => undefined)
        const base = candidate(1)
        const service = serviceFor([base], {
            now: () => now,
            saveSnapshot,
            fetchRecognized: async () => ({
                tokens: new Map([[base.address, recognized(1)]]),
                partial,
                successfulBatches: 1,
                failedBatches: partial ? 1 : 0,
            }),
        })
        const first = await service.refreshCatalog()
        expect(saveSnapshot).toHaveBeenCalledTimes(1)
        now += 11
        partial = true
        const retained = await service.refreshCatalog()
        expect(retained.tokens).toEqual(first.tokens)
        expect(saveSnapshot).toHaveBeenCalledTimes(1)
    })

    it('uses CoinGecko multi-token data only for requested exact addresses', async () => {
        const requested = address(700)
        const other = address(701)
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                new Response(
                    JSON.stringify({
                        data: [
                            {
                                id: `bsc_${requested}`,
                                type: 'token',
                                attributes: {
                                    address: requested,
                                    name: 'Exact',
                                    symbol: 'SAME',
                                    decimals: 18,
                                    image_url: 'https://coin-images.coingecko.com/exact.png',
                                    coingecko_coin_id: 'exact',
                                },
                            },
                            {
                                id: `bsc_${other}`,
                                type: 'token',
                                attributes: {
                                    address: other,
                                    name: 'Other',
                                    symbol: 'SAME',
                                    decimals: 18,
                                    coingecko_coin_id: 'other',
                                },
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            ),
        )
        const result = await getCoinGeckoTokensBatch([requested])
        expect([...result.tokens.keys()]).toEqual([requested])
    })

    it('rejects non-image responses and untrusted image hosts', async () => {
        const fetchMock = vi.fn(async () =>
            new Response('not an image', {
                status: 200,
                headers: { 'content-type': 'text/html' },
            }),
        )
        vi.stubGlobal('fetch', fetchMock)
        await expect(
            validateRemoteLogoUrl(
                'https://coin-images.coingecko.com/not-an-image-unique',
            ),
        ).resolves.toBe(false)
        await expect(
            validateRemoteLogoUrl('https://untrusted.example/logo.png'),
        ).resolves.toBe(false)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('falls back to a bounded GET when an image host rejects HEAD', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(null, { status: 405 }))
            .mockResolvedValueOnce(
                new Response(new Uint8Array([1, 2, 3]), {
                    status: 206,
                    headers: {
                        'content-type': 'image/png',
                        'content-length': '3',
                    },
                }),
            )
        vi.stubGlobal('fetch', fetchMock)
        await expect(
            validateRemoteLogoUrl(
                'https://coin-images.coingecko.com/head-fallback-unique.png',
            ),
        ).resolves.toBe(true)
        expect(fetchMock.mock.calls[0][1].method).toBe('HEAD')
        expect(fetchMock.mock.calls[1][1].method).toBe('GET')
        expect(fetchMock.mock.calls[1][1].headers.range).toBe(
            'bytes=0-2097151',
        )
    })

    it('fails startup validation for invalid established-token numbers', () => {
        process.env.ESTABLISHED_TOKEN_MIN_LIQUIDITY_USD = 'not-a-number'
        expect(() => getApiConfig()).toThrow(
            'ESTABLISHED_TOKEN_MIN_LIQUIDITY_USD',
        )
    })
})
