import { readFile } from 'node:fs/promises'

import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProviderError } from '../src/lib/errors.js'
import type { MarketCatalogPersistence, PersistedCatalogWrite, PersistedMarketCatalog } from '../src/market-catalog/persistence.js'
import {
    MARKET_CATALOG_SCHEMA_VERSION,
    type MarketDependencies,
    type MarketToken,
    createMarketCatalogService,
    createMarketTokenRoutes,
    isPartialCatalogDemonstrablyBetter,
    normalizePublicMarketToken,
} from '../src/modules/market-tokens.js'
import { ACTIVE_TOKEN_DISCOVERY_CHAINS } from '../src/token-discovery/registry.js'

const NOW = Date.parse('2026-07-19T12:00:00.000Z')
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'

function rankedToken(chainId = 56, address = WBNB, symbol = 'WBNB') {
    return normalizePublicMarketToken({
        id: `${chainId}:${address}`,
        chainId,
        address,
        name: symbol,
        symbol,
        decimals: 18,
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/info/logo.png',
        logoCandidates: ['https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/info/logo.png'],
        logoSource: 'trustwallet',
        chainLogoURI: null,
        coinGeckoId: symbol.toLowerCase(),
        priceUSD: '1',
        volume24hUsd: 500_000,
        liquidityUsd: 500_000,
        transactions24h: 500,
        pairCount: 2,
        oldestPairCreatedAt: '2020-01-01T00:00:00.000Z',
        marketUrl: null,
        rank: 1,
        verificationStatus: 'recognized',
        verificationReasons: [
            'coingecko-exact-contract',
            'minimum-liquidity-met',
            'minimum-volume-met',
        ],
        possibleSpam: false,
        visibility: 'primary',
        securityStatus: 'trusted',
        source: 'provider',
    } satisfies MarketToken, 'volume')
}

function persistedRow({
    chainId = 56,
    tokens = [rankedToken(chainId)],
    schemaVersion = MARKET_CATALOG_SCHEMA_VERSION,
    lastSuccessAt = new Date(NOW - 60_000),
}: {
    chainId?: number
    tokens?: MarketToken[]
    schemaVersion?: number
    lastSuccessAt?: Date | null
} = {}): PersistedMarketCatalog {
    return {
        chainId,
        schemaVersion,
        rankedTokens: tokens,
        commonTokens: [],
        providerStatus: { availableProviders: ['dexpaprika'], unavailableProviders: [] },
        exclusionCounts: {},
        partial: false,
        generatedAt: lastSuccessAt,
        lastAttemptedAt: lastSuccessAt,
        lastSuccessAt,
        nextRefreshAt: null,
        contentHash: `hash-${chainId}`,
        updatedAt: new Date(NOW),
    }
}

function memoryPersistence(rows: PersistedMarketCatalog[] = []) {
    const values = new Map(rows.map((row) => [row.chainId, row]))
    const saves: PersistedCatalogWrite[] = []
    const attempts: Array<{ chainId: number }> = []
    const persistence: MarketCatalogPersistence = {
        async loadAll() {
            return [...values.values()]
        },
        async saveUsefulCatalog(value) {
            saves.push(value)
            values.set(value.chainId, { ...value, updatedAt: new Date() })
        },
        async recordAttempt(value) {
            attempts.push(value)
            const current = values.get(value.chainId)
            values.set(value.chainId, {
                ...(current ?? persistedRow({
                    chainId: value.chainId,
                    tokens: [],
                    schemaVersion: value.schemaVersion,
                    lastSuccessAt: null,
                })),
                providerStatus: value.providerStatus ?? current?.providerStatus ?? {},
                lastAttemptedAt: value.lastAttemptedAt,
                nextRefreshAt: value.nextRefreshAt,
                updatedAt: new Date(),
            })
        },
    }
    return { persistence, values, saves, attempts }
}

function emptyDependencies(
    persistence: MarketCatalogPersistence,
    now: () => number = () => NOW,
): Partial<MarketDependencies> {
    return {
        persistence,
        now,
        discoverDexPaprika: async ({ chainId }) => ({
            tokens: [], networkId: String(chainId), partial: false,
            malformedCount: 0, hasNextPage: false,
        }),
        discoverCandidates: async () => ({
            candidates: [], pagesCompleted: 0, partial: false,
        }),
        fetchRecognized: async () => ({
            tokens: new Map(), partial: false, successfulBatches: 0, failedBatches: 0,
        }),
        fetchMarkets: async () => ({
            markets: new Map(), partial: false, successfulBatches: 0, failedBatches: 0,
        }),
        fetchMetadata: async () => new Map(),
        fetchDecimals: async () => new Map(),
        validateLogos: async () => null,
        loadSnapshot: async () => null,
        saveSnapshot: async () => undefined,
    }
}

function usefulDependencies(
    persistence: MarketCatalogPersistence,
    now: () => number = () => NOW,
): Partial<MarketDependencies> {
    return {
        ...emptyDependencies(persistence, now),
        discoverDexPaprika: async () => ({
            tokens: [{
                provider: 'dexpaprika', chainId: 56, address: WBNB,
                name: 'Wrapped BNB', symbol: 'WBNB', decimals: 18,
                priceUSD: '600', marketPriceUSD: '600', priceChange24hPercent: 1,
                volume24hUsd: 1_000_000, volume7dUsd: 7_000_000,
                volume30dUsd: 30_000_000, liquidityUsd: 2_000_000,
                fdvUsd: 10_000_000, transactions24h: 1_000, poolsCount: 20,
                createdAt: '2020-01-01T00:00:00.000Z', hasProviderImage: true,
                recognitionStatus: 'unverified', verifiedContract: false,
                possibleSpam: null, securityStatus: 'unknown', visibility: 'unverified',
                logoURI: null, logoCandidates: [],
            }],
            networkId: 'bsc', partial: false, malformedCount: 0, hasNextPage: false,
        }),
        fetchRecognized: async () => ({
            tokens: new Map([[WBNB, {
                address: WBNB, name: 'Wrapped BNB', symbol: 'WBNB', decimals: 18,
                imageUrl: 'https://coin-images.coingecko.com/wbnb.png',
                coinGeckoId: 'wbnb', priceUSD: '600', imageSource: 'coingecko',
            }]]),
            partial: false, successfulBatches: 1, failedBatches: 0,
        }),
        fetchMarkets: async () => ({
            markets: new Map([[WBNB, {
                address: WBNB, name: 'Wrapped BNB', symbol: 'WBNB', priceUSD: '600',
                volume24hUsd: 1_000_000, liquidityUsd: 2_000_000, pairCount: 2,
                pairUrl: null, oldestPairCreatedAt: '2020-01-01T00:00:00.000Z',
            }]]),
            partial: false, successfulBatches: 1, failedBatches: 0,
        }),
        validateLogos: async (entries) => ({
            logoURI: entries[0].url,
            logoCandidates: entries.map((entry) => entry.url),
            logoSource: entries[0].source,
        }),
    }
}

describe.sequential('persistent market catalog and rolling scheduler', () => {
    const previousEnvironment = { ...process.env }

    beforeEach(() => {
        process.env.ESTABLISHED_TOKEN_SNAPSHOT_ENABLED = 'false'
        process.env.DEXPAPRIKA_MIN_LIQUIDITY_USD = '100000'
        process.env.DEXPAPRIKA_MIN_TXNS_24H = '50'
    })

    afterEach(() => {
        vi.useRealTimers()
        process.env = { ...previousEnvironment }
    })

    it('stores a successful useful normalized catalog and hydrates it after restart', async () => {
        const store = memoryPersistence()
        const first = createMarketCatalogService(usefulDependencies(store.persistence))
        const refreshed = await first.refreshCatalog(56)
        expect(refreshed.tokens.length).toBeGreaterThan(0)
        expect(store.saves).toHaveLength(1)
        expect(store.saves[0].rankedTokens.length).toBeGreaterThan(0)
        expect(JSON.stringify(store.saves[0])).not.toMatch(/api[_-]?key|authenticatedUrl|walletAddress/i)

        const restarted = createMarketCatalogService(emptyDependencies(store.persistence))
        await expect(restarted.hydratePersistentCatalogs()).resolves.toMatchObject({
            loaded: 1, degraded: false,
        })
        const result = await restarted.getCatalog(56, { backgroundOnMiss: true })
        expect(result.catalog.tokens).toHaveLength(store.saves[0].rankedTokens.length)
        expect(result.catalog.persistence.source).toBe('database')
    })

    it('ignores incompatible schema rows', async () => {
        const store = memoryPersistence([persistedRow({ schemaVersion: 4 })])
        const service = createMarketCatalogService(emptyDependencies(store.persistence))
        await expect(service.hydratePersistentCatalogs()).resolves.toMatchObject({
            loaded: 0, ignored: 1,
        })
    })

    it('continues with curated fallback when persistence is unavailable', async () => {
        const store = memoryPersistence()
        store.persistence.loadAll = async () => { throw new Error('database unavailable') }
        const service = createMarketCatalogService(emptyDependencies(store.persistence))
        await expect(service.hydratePersistentCatalogs()).resolves.toMatchObject({
            loaded: 0, degraded: true,
        })
        await expect(service.getCatalog(10, { backgroundOnMiss: true }))
            .resolves.toMatchObject({
                catalog: { persistence: { source: 'curated' } },
            })
    })

    it('retains a useful persisted catalog after an empty refresh', async () => {
        const existing = persistedRow()
        const store = memoryPersistence([existing])
        const service = createMarketCatalogService(emptyDependencies(store.persistence))
        await service.hydratePersistentCatalogs()
        const refreshed = await service.refreshCatalog(56)
        expect(refreshed.tokens).toEqual(existing.rankedTokens)
        expect(store.saves).toHaveLength(0)
        expect(store.values.get(56)?.rankedTokens).toEqual(existing.rankedTokens)
    })

    it('persists first-attempt scheduling metadata without serving an empty placeholder', async () => {
        const store = memoryPersistence()
        const service = createMarketCatalogService(emptyDependencies(store.persistence))
        await service.refreshCatalog(56)

        const placeholder = store.values.get(56)
        expect(placeholder).toMatchObject({
            schemaVersion: MARKET_CATALOG_SCHEMA_VERSION,
            rankedTokens: [],
            lastAttemptedAt: expect.any(Date),
            nextRefreshAt: expect.any(Date),
        })

        const restarted = createMarketCatalogService(emptyDependencies(store.persistence))
        await expect(restarted.hydratePersistentCatalogs()).resolves.toMatchObject({
            loaded: 0,
            ignored: 1,
        })
        expect(restarted.selectScheduledChain()?.chainId).not.toBe(56)
        const catalog = await restarted.getCatalog(56, { backgroundOnMiss: true })
        expect(catalog.catalog.persistence.source).toBe('curated')
    })

    it.each([
        ['rate limiting', new ProviderError({
            code: 'PROVIDER_RATE_LIMITED', message: 'Rate limited.',
            retryable: true, outcome: 'rate-limit', upstreamStatus: 429,
            retryAfterMs: 120_000,
        })],
        ['an abort', new DOMException('Aborted', 'AbortError')],
        ['malformed provider data', new Error('Malformed provider response')],
    ])('does not erase persisted data after %s', async (_label, failure) => {
        const existing = persistedRow()
        const store = memoryPersistence([existing])
        const dependencies = emptyDependencies(store.persistence)
        dependencies.discoverDexPaprika = async () => { throw failure }
        const service = createMarketCatalogService(dependencies)
        await service.hydratePersistentCatalogs()
        const refreshed = await service.refreshCatalog(56)
        expect(refreshed.tokens).toEqual(existing.rankedTokens)
        expect(store.values.get(56)?.rankedTokens).toEqual(existing.rankedTokens)
        expect(store.saves).toHaveLength(0)
    })

    it('accepts only demonstrably better partial catalog quality', () => {
        expect(isPartialCatalogDemonstrablyBetter({
            existingRankedCount: 10,
            nextRankedCount: 11,
            existingProviderCount: 4,
            nextProviderCount: 2,
        })).toBe(true)
        expect(isPartialCatalogDemonstrablyBetter({
            existingRankedCount: 10,
            nextRankedCount: 9,
            existingProviderCount: 2,
            nextProviderCount: 4,
        })).toBe(false)
    })

    it('selects oldest success first and refreshes one chain per tick', async () => {
        let now = NOW
        const rows = ACTIVE_TOKEN_DISCOVERY_CHAINS.map((chain, index) =>
            persistedRow({
                chainId: chain.chainId,
                tokens: [rankedToken(chain.chainId, `0x${(index + 1).toString(16).padStart(40, '0')}`)],
                lastSuccessAt: new Date(NOW + index * 1_000),
            }))
        const store = memoryPersistence(rows)
        const service = createMarketCatalogService(emptyDependencies(
            store.persistence,
            () => now,
        ))
        await service.hydratePersistentCatalogs()
        expect(service.selectScheduledChain()?.chainId).toBe(
            ACTIVE_TOKEN_DISCOVERY_CHAINS[0].chainId,
        )
        const refreshedChainIds = []
        for (let tick = 0; tick < 24; tick += 1) {
            const result = await service.runScheduledRefreshTick()
            refreshedChainIds.push(result.chainId)
            now += 60_000
        }
        expect(new Set(refreshedChainIds).size).toBe(24)
        expect(store.attempts).toHaveLength(48)
    })

    it('skips a chain whose refresh is already in flight', async () => {
        let release!: () => void
        const pending = new Promise<void>((resolve) => { release = resolve })
        const store = memoryPersistence()
        const dependencies = emptyDependencies(store.persistence)
        dependencies.discoverDexPaprika = async ({ chainId }) => {
            if (chainId === 1) await pending
            return { tokens: [], networkId: String(chainId), partial: false,
                malformedCount: 0, hasNextPage: false }
        }
        const service = createMarketCatalogService(dependencies)
        const ethereumRefresh = service.refreshCatalog(1)
        await vi.waitFor(() => expect(store.attempts).toHaveLength(1))
        expect(service.selectScheduledChain()?.chainId).toBe(56)
        release()
        await ethereumRefresh
    })

    it('starts only one scheduler and stops it cleanly', () => {
        vi.useFakeTimers()
        const store = memoryPersistence()
        const service = createMarketCatalogService(emptyDependencies(store.persistence))
        const stopFirst = service.startRollingRefresh({ jitterMaxMs: 0 })
        const stopSecond = service.startRollingRefresh({ jitterMaxMs: 0 })
        expect(stopSecond).toBe(stopFirst)
        expect(service.isSchedulerRunningForTest()).toBe(true)
        stopFirst()
        expect(service.isSchedulerRunningForTest()).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('returns 304 for an unchanged catalog ETag', async () => {
        const store = memoryPersistence([persistedRow()])
        const service = createMarketCatalogService(emptyDependencies(store.persistence))
        await service.hydratePersistentCatalogs()
        const app = Fastify()
        await app.register(createMarketTokenRoutes(service))
        const first = await app.inject('/v1/market-tokens?chainId=56')
        expect(first.statusCode).toBe(200)
        expect(first.json().persistence.source).toBe('database')
        const second = await app.inject({
            method: 'GET',
            url: '/v1/market-tokens?chainId=56',
            headers: { 'if-none-match': first.headers.etag! },
        })
        expect(second.statusCode).toBe(304)
        expect(second.body).toBe('')
        await app.close()
    })

    it('defines the PostgreSQL cache table without secret or wallet fields', async () => {
        const migration = await readFile(
            new URL('../drizzle/0005_market_token_catalog_cache.sql', import.meta.url),
            'utf8',
        )
        expect(migration).toContain('CREATE TABLE market_token_catalog_cache')
        expect(migration).toContain('ranked_tokens jsonb NOT NULL')
        expect(migration).not.toMatch(/api_key|private_key|wallet_address|authenticated_url/i)
    })
})
