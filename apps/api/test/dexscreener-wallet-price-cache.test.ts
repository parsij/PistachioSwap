import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { aggregateTokenMarkets } from '../src/providers/dexscreener/token-markets.js'
import { normalizeDexPair } from '../src/providers/dexscreener/dexscreener-client.js'

import type { WalletToken } from '../src/providers/alchemy/wallet-tokens.js'
import {
    createDexScreenerWalletPriceCache,
} from '../src/providers/dexscreener/wallet-price-cache.js'
import type {
    ShapeShiftAssetCatalog,
} from '../src/token-discovery/shapeshift-asset-catalog.js'

const listedAddress = '0x1111111111111111111111111111111111111111'
const unknownAddress = '0x2222222222222222222222222222222222222222'
const wallet = '0x3333333333333333333333333333333333333333'

function walletToken(address: string, name = 'Wallet Token'): WalletToken {
    return {
        classificationVersion: 6,
        id: `56:${address}`,
        chainId: 56,
        address,
        name,
        symbol: 'TOK',
        decimals: 18,
        logoURI: null,
        logoCandidates: [],
        rawBalance: '2000000000000000000',
        formattedBalance: '2',
        balance: '2',
        priceUSD: '999',
        trustedPriceUSD: '999',
        marketPriceUSD: '999',
        valueUSD: '1998',
        priceConfidence: 'market',
        coinGeckoId: null,
        liquidityUsd: 0,
        trustedLiquidityUsd: null,
        largestTrustedPoolLiquidityUsd: null,
        volume24hUsd: null,
        transactionCount24h: null,
        uniqueTraders24h: null,
        trustedPairCount: null,
        oldestTrustedPoolCreatedAt: null,
        establishedAgeDays: null,
        estimatedSellValueUsd: '1998',
        classificationTier: 'hidden',
        classificationReasons: ['unverified-identity'],
        isNative: false,
        recognitionStatus: 'unverified',
        recognitionReasons: [],
        verificationStatus: 'unverified',
        verificationReasons: [],
        spamStatus: 'unknown',
        possibleSpam: null,
        verifiedContract: null,
        spamReasons: [],
        visibility: 'unverified',
        visibilityReasons: ['unverified-contract'],
        securityStatus: 'unknown',
        securityScore: null,
        securityReasons: [],
        securityProviders: {
            honeypot: {
                available: false,
                checkedAt: null,
                risk: null,
                riskLevel: null,
                isHoneypot: null,
            },
            goPlus: {
                available: false,
                checkedAt: null,
                isHoneypot: null,
            },
        },
        includeInPortfolioValue: false,
    }
}

function shapeShiftCatalog(): ShapeShiftAssetCatalog {
    const assetId = `eip155:56/erc20:${listedAddress}`
    return {
        schemaVersion: 1,
        generatedAt: '2026-07-24T00:00:00.000Z',
        source: {
            name: 'shapeshift',
            ref: 'test-ref',
            url: 'https://example.test/generatedAssetData.json',
        },
        byId: {
            [assetId]: {
                assetId,
                chainId: 56,
                address: listedAddress,
                isNative: false,
                name: 'ShapeShift Token',
                symbol: 'SST',
                decimals: 18,
                icon: 'https://example.test/token.png',
                source: 'shapeshift',
            },
        },
        ids: [assetId],
        chains: { '56': { count: 1 } },
    }
}

function marketResult(priceUSD: string) {
    return {
        markets: new Map([[listedAddress, {
            address: listedAddress,
            name: 'ShapeShift Token',
            symbol: 'SST',
            priceUSD,
            volume24hUsd: 25_000,
            liquidityUsd: 150_000,
            pairCount: 2,
            pairUrl: 'https://dexscreener.com/bsc/pair',
            oldestPairCreatedAt: '2025-01-01T00:00:00.000Z',
        }]]),
        partial: false,
        successfulBatches: 1,
        failedBatches: 0,
    }
}

describe('DexScreener ShapeShift wallet price cache', () => {
    const temporaryPaths: string[] = []

    afterEach(async () => {
        vi.restoreAllMocks()
        await Promise.all(temporaryPaths.splice(0).map((directory) =>
            rm(directory, { recursive: true, force: true })))
    })

    async function setup() {
        const directory = await mkdtemp(path.join(tmpdir(), 'pistachio-wallet-prices-'))
        temporaryPaths.push(directory)
        const cachePath = path.join(directory, 'wallet-prices.json')
        let currentTime = Date.parse('2026-07-24T12:00:00.000Z')
        const fetchMarkets = vi.fn(async () => marketResult('12.50'))
        const loadCatalog = vi.fn(async () => ({
            path: path.join(directory, 'shapeshift.json'),
            catalog: shapeShiftCatalog(),
            source: 'shapeshift-local' as const,
        }))
        const cache = createDexScreenerWalletPriceCache({
            path: cachePath,
            now: () => currentTime,
            fetchMarkets,
            loadCatalog,
            priceTtlMs: 30 * 60_000,
        })
        return {
            cache,
            cachePath,
            fetchMarkets,
            loadCatalog,
            now: () => currentTime,
            advance: (milliseconds: number) => {
                currentTime += milliseconds
            },
        }
    }

    it('turns a quote-side stablecoin price into the correct wallet USD value', async () => {
        const { cache, fetchMarkets } = await setup()
        const normalized = normalizeDexPair({
            chainId: 'bsc', pairAddress: wallet,
            baseToken: { address: unknownAddress, name: 'Wrapped BNB', symbol: 'WBNB' },
            quoteToken: { address: listedAddress, name: 'USD Coin', symbol: 'USDC' },
            priceUsd: '2492.5', priceNative: '2500', liquidity: { usd: 1000000 },
        })!
        fetchMarkets.mockResolvedValue({
            markets: aggregateTokenMarkets([normalized]), partial: false,
            successfulBatches: 1, failedBatches: 0,
        })
        const [result] = await cache.enrichWalletTokens([{
            ...walletToken(listedAddress), rawBalance: '20000000000000000000',
            balance: '20', formattedBalance: '20',
        }])
        expect(result).toMatchObject({
            priceUSD: '0.997', trustedPriceUSD: '0.997', valueUSD: '19.94',
            priceConfidence: 'trusted', includeInPortfolioValue: true,
        })
    })

    it('prices only exact ShapeShift contracts and strips unknown token prices', async () => {
        const setupResult = await setup()
        const result = await setupResult.cache.enrichWalletTokens([
            walletToken(listedAddress),
            walletToken(unknownAddress, 'Unknown Token'),
        ])

        expect(setupResult.fetchMarkets).toHaveBeenCalledOnce()
        expect(setupResult.fetchMarkets).toHaveBeenCalledWith(
            [listedAddress],
            undefined,
            56,
        )
        expect(result[0]).toMatchObject({
            name: 'ShapeShift Token',
            symbol: 'SST',
            priceUSD: '12.50',
            valueUSD: '25',
            classificationTier: 'established',
            visibility: 'primary',
            securityStatus: 'trusted',
            possibleSpam: false,
            verifiedContract: true,
            includeInPortfolioValue: true,
        })
        expect(result[0].recognitionReasons).toContain('shapeshift-asset-catalog')
        expect(result[1]).toMatchObject({
            priceUSD: null,
            trustedPriceUSD: null,
            marketPriceUSD: null,
            valueUSD: null,
            estimatedSellValueUsd: null,
            priceConfidence: 'unknown',
            includeInPortfolioValue: false,
        })
    })

    it('reuses fresh prices, persists timestamps, and hydrates after restart', async () => {
        const first = await setup()
        const token = walletToken(listedAddress)

        await first.cache.enrichWalletTokens([token])
        await first.cache.enrichWalletTokens([token])
        expect(first.fetchMarkets).toHaveBeenCalledOnce()
        await first.cache.flush()

        const persisted = JSON.parse(await readFile(first.cachePath, 'utf8'))
        const entry = persisted.entries[`56:${listedAddress}`]
        expect(entry).toMatchObject({
            priceUSD: '12.50',
            liquidityUsd: 150_000,
        })
        expect(Date.parse(entry.expiresAt) - Date.parse(entry.fetchedAt))
            .toBe(30 * 60_000)

        const restartedFetch = vi.fn(async () => marketResult('13.00'))
        const restarted = createDexScreenerWalletPriceCache({
            path: first.cachePath,
            now: first.now,
            fetchMarkets: restartedFetch,
            loadCatalog: first.loadCatalog,
            priceTtlMs: 30 * 60_000,
        })
        const result = await restarted.enrichWalletTokens([token])

        expect(restartedFetch).not.toHaveBeenCalled()
        expect(result[0].priceUSD).toBe('12.50')
    })

    it('refreshes an expired entry and retains stale data if refresh fails', async () => {
        const setupResult = await setup()
        const token = walletToken(listedAddress)

        await setupResult.cache.enrichWalletTokens([token])
        setupResult.advance(31 * 60_000)
        setupResult.fetchMarkets.mockResolvedValueOnce(marketResult('13.75'))
        const refreshed = await setupResult.cache.enrichWalletTokens([token])
        expect(refreshed[0].priceUSD).toBe('13.75')
        expect(setupResult.fetchMarkets).toHaveBeenCalledTimes(2)

        setupResult.advance(31 * 60_000)
        setupResult.fetchMarkets.mockRejectedValueOnce(new Error('provider unavailable'))
        const stale = await setupResult.cache.enrichWalletTokens([token])
        expect(stale[0].priceUSD).toBe('13.75')
        expect(setupResult.fetchMarkets).toHaveBeenCalledTimes(3)
    })

    it('does not erase a measured stablecoin price when a successful market batch omits pricing', async () => {
        const { cache, fetchMarkets, advance } = await setup()
        const token = walletToken(listedAddress)
        fetchMarkets.mockResolvedValueOnce(marketResult('0.997'))
        await cache.enrichWalletTokens([token])
        advance(31 * 60_000)
        fetchMarkets.mockResolvedValueOnce({ markets: new Map(), partial: false, successfulBatches: 1, failedBatches: 0 })
        const [retained] = await cache.enrichWalletTokens([token])
        expect(retained.priceUSD).toBe('0.997')
        expect(retained.valueUSD).toBe('1.994')
        advance(6 * 60_000)
        fetchMarkets.mockResolvedValueOnce(marketResult('0.985'))
        const [updated] = await cache.enrichWalletTokens([token])
        expect(updated.priceUSD).toBe('0.985')
        expect(updated.valueUSD).toBe('1.97')
    })

    it('does not let a stale unlisted token retain a provider-supplied price', async () => {
        const setupResult = await setup()
        const result = await setupResult.cache.enrichWalletTokens([
            walletToken(unknownAddress),
        ])

        expect(setupResult.fetchMarkets).not.toHaveBeenCalled()
        expect(result[0].priceUSD).toBeNull()
        expect(result[0].valueUSD).toBeNull()
    })
})
