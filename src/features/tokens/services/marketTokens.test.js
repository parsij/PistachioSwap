import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    fetchMarketTokens,
    filterEligibleMarketTokens,
    getCanonicalTokenIdentity,
    getMarketTokenCacheKey,
    MARKET_TOKEN_CACHE_PREFIX,
    migrateLegacyMarketTokenCache,
} from './marketTokens.js'
import {
    isLatestMarketTokenRequest,
} from '../hooks/useMarketTokens.js'
import {
    getTokenFallbackLetter,
    getTokenLogoCandidates,
} from '../components/tokenIconUtils.js'
import { mergeWalletBalances } from './walletTokens.js'

function createLocalStorage(initial = {}) {
    const values = new Map(Object.entries(initial))

    return {
        get length() {
            return values.size
        },
        getItem: vi.fn((key) => values.get(key) ?? null),
        setItem: vi.fn((key, value) => values.set(key, String(value))),
        removeItem: vi.fn((key) => values.delete(key)),
        key: vi.fn((index) => [...values.keys()][index] ?? null),
        values,
    }
}

function classifiedToken(overrides = {}) {
    const chainId = overrides.chainId ?? 56
    const address = overrides.address ?? '0x0000000000000000000000000000000000000001'
    return {
        chainId, address, canonicalId: `${chainId}:${address}`,
        catalogSection: 'volume', recognitionStatus: 'recognized',
        recognitionReasons: ['coingecko-exact-contract'],
        verifiedContract: true, possibleSpam: false,
        logoCandidates: ['https://images.example/token.png'],
        ...overrides,
    }
}

function catalogPayload(tokens = [], overrides = {}) {
    return {
        schemaVersion: 5,
        tokens,
        count: tokens.length,
        commonTokens: [],
        commonCount: 0,
        ...overrides,
    }
}

describe.sequential('frontend market-token services', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('separates browser cache entries by normalized query', () => {
        const empty = getMarketTokenCacheKey({
            chainId: 56,
            query: '',
            limit: 100,
        })
        const search = getMarketTokenCacheKey({
            chainId: 56,
            query: '  USDT ',
            limit: 20,
        })
        expect(search).not.toBe(empty)
        expect(search.startsWith(MARKET_TOKEN_CACHE_PREFIX)).toBe(true)
        expect(search).not.toContain('market-tokens:v1:')
        expect(search).not.toContain('market-tokens:v2:')
        expect(search).toContain('market-tokens:v5:')
        expect(search).toBe(
            getMarketTokenCacheKey({
                chainId: 56,
                query: 'usdt',
                limit: 20,
            }),
        )
    })

    it('removes the known legacy market-token cache namespace only', () => {
        const storage = createLocalStorage({
            'pistachioswap:market-tokens:v1:old': '{}',
            'pistachioswap:market-tokens:v2:random-catalog': '{}',
            'pistachioswap:market-tokens:v4:obsolete': '{}',
            'pistachioswap:recent-token-searches:v2:56': '[]',
            unrelated: 'keep',
        })
        vi.stubGlobal('window', { localStorage: storage })

        migrateLegacyMarketTokenCache()

        expect(storage.values.has('pistachioswap:market-tokens:v1:old')).toBe(
            false,
        )
        expect(
            storage.values.has(
                'pistachioswap:market-tokens:v2:random-catalog',
            ),
        ).toBe(false)
        expect(storage.values.has('pistachioswap:market-tokens:v4:obsolete'))
            .toBe(false)
        expect(storage.values.get('unrelated')).toBe('keep')
        expect(
            storage.values.has('pistachioswap:recent-token-searches:v2:56'),
        ).toBe(true)
    })

    it('does not cache an empty successful search response', async () => {
        const storage = createLocalStorage()
        vi.stubGlobal('window', { localStorage: storage })
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                new Response(JSON.stringify(catalogPayload()), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            ),
        )

        await fetchMarketTokens({
            query: 'not-found',
            apiBaseUrl: 'http://localhost:3001',
        })
        expect(storage.setItem).not.toHaveBeenCalled()
    })

    it('refreshes a partial default catalog after one minute', async () => {
        const key = getMarketTokenCacheKey({
            chainId: 56,
            query: '',
            limit: 100,
        })
        const storage = createLocalStorage({
            [key]: JSON.stringify({
                cachedAt: Date.now() - 60_001,
                payload: {
                    tokens: [{
                        chainId: 56,
                        address: '0x0000000000000000000000000000000000000001',
                        symbol: 'OLD',
                    }],
                    metadata: { providerPartial: true },
                },
            }),
        })
        const fetchMock = vi.fn(async () =>
            new Response(
                JSON.stringify(catalogPayload([classifiedToken({ symbol: 'NEW' })])),
                { status: 200 },
            ),
        )
        vi.stubGlobal('window', { localStorage: storage })
        vi.stubGlobal('fetch', fetchMock)

        const result = await fetchMarketTokens({
            apiBaseUrl: 'http://localhost:3001',
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(result.tokens[0].symbol).toBe('NEW')
    })

    it('invalidates schema-v5 curated records with fallback-only logos', async () => {
        const key = getMarketTokenCacheKey({ chainId: 56, query: '', limit: 100 })
        const storage = createLocalStorage({
            [key]: JSON.stringify({
                cachedAt: Date.now(),
                payload: catalogPayload([], {
                    commonCount: 1,
                    commonTokens: [{
                        chainId: 56,
                        address: '0x0000000000000000000000000000000000000002',
                        catalogSection: 'common',
                        officialAsset: true,
                        logoCandidates: ['/icons/token-fallback.svg'],
                    }],
                }),
            }),
        })
        const fetchMock = vi.fn(async () => new Response(
            JSON.stringify(catalogPayload()), { status: 200 },
        ))
        vi.stubGlobal('window', { localStorage: storage })
        vi.stubGlobal('fetch', fetchMock)
        await fetchMarketTokens({ apiBaseUrl: 'http://localhost:3001' })
        expect(fetchMock).toHaveBeenCalledOnce()
        expect(storage.removeItem).toHaveBeenCalledWith(key)
    })

    it('normalizes partial, stale, hard-stale, and unavailable status', async () => {
        const storage = createLocalStorage()
        vi.stubGlobal('window', { localStorage: storage })
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(catalogPayload([], {
            partial: true,
            stale: false,
            hardStale: false,
            catalogUnavailable: true,
            metadata: {
                availableProviders: [],
                unavailableProviders: [{
                    provider: 'geckoterminal',
                    code: 'PROVIDER_UNAVAILABLE',
                }],
            },
        })), { status: 200 })))

        await expect(fetchMarketTokens({
            apiBaseUrl: 'http://localhost:3001',
        })).resolves.toMatchObject({
            tokens: [],
            partial: true,
            stale: false,
            hardStale: false,
            catalogUnavailable: true,
        })
        expect(storage.setItem).not.toHaveBeenCalled()
    })

    it('falls back to a cached catalog after an unexpected non-200 response', async () => {
        const key = getMarketTokenCacheKey({
            chainId: 56,
            query: '',
            limit: 100,
        })
        const cachedToken = classifiedToken({ symbol: 'CACHED' })
        const storage = createLocalStorage({
            [key]: JSON.stringify({
                cachedAt: Date.now() - 10 * 60 * 1000 - 1,
                payload: catalogPayload([cachedToken]),
            }),
        })
        vi.stubGlobal('window', { localStorage: storage })
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
            status: 503,
        })))

        await expect(fetchMarketTokens({
            apiBaseUrl: 'http://localhost:3001',
        })).resolves.toMatchObject({
            tokens: [cachedToken],
            partial: true,
            stale: true,
            hardStale: true,
            browserCache: 'stale-fallback',
        })
    })

    it('revalidates an unchanged catalog with ETag and consumes HTTP 304', async () => {
        const storage = createLocalStorage()
        const token = classifiedToken({ symbol: 'ETAG' })
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(
                JSON.stringify(catalogPayload([token])),
                { status: 200, headers: { etag: '"market-v5-content"' } },
            ))
            .mockResolvedValueOnce(new Response(null, { status: 304 }))
        vi.stubGlobal('window', { localStorage: storage })
        vi.stubGlobal('fetch', fetchMock)

        await fetchMarketTokens({ apiBaseUrl: 'http://localhost:3001' })
        const result = await fetchMarketTokens({
            apiBaseUrl: 'http://localhost:3001',
            forceRefresh: true,
        })

        expect(fetchMock.mock.calls[1][1].headers['if-none-match'])
            .toBe('"market-v5-content"')
        expect(result.tokens).toEqual([token])
        expect(result.browserCache).toBe('revalidated')
    })

    it('uses a stable all-chain key and sends all only to the market endpoint', async () => {
        const storage = createLocalStorage()
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(
            catalogPayload([classifiedToken({ chainId: 1, symbol: 'ONE' })]),
        ), { status: 200 }))
        vi.stubGlobal('window', { localStorage: storage })
        vi.stubGlobal('fetch', fetchMock)

        expect(getMarketTokenCacheKey({
            chainId: 'ALL',
            query: ' Eth ',
            limit: 20,
        })).toBe(getMarketTokenCacheKey({
            chainId: 'all',
            query: 'eth',
            limit: 20,
        }))
        await fetchMarketTokens({
            chainId: 'all',
            query: 'eth',
            apiBaseUrl: 'http://localhost:3001',
        })
        expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('chainId'))
            .toBe('all')
    })

    it('rejects a malformed token identity before caching it', async () => {
        const storage = createLocalStorage()
        vi.stubGlobal('window', { localStorage: storage })
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(
            catalogPayload([{ chainId: 'oops', address: 'not-an-address' }]),
        ), { status: 200 })))

        await expect(fetchMarketTokens({
            apiBaseUrl: 'http://localhost:3001',
        })).rejects.toThrow('malformed token identity')
        expect(storage.setItem).not.toHaveBeenCalled()
    })

    it('does not cache rate-limit or provider-error responses', async () => {
        const storage = createLocalStorage()
        vi.stubGlobal('window', { localStorage: storage })
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('{}', { status: 429 })),
        )

        await expect(
            fetchMarketTokens({
                query: 'usdt',
                apiBaseUrl: 'http://localhost:3001',
            }),
        ).rejects.toThrow('429')
        expect(storage.setItem).not.toHaveBeenCalled()
    })

    it('passes AbortSignal cancellation to active search requests', async () => {
        const storage = createLocalStorage()
        vi.stubGlobal('window', { localStorage: storage })
        vi.stubGlobal(
            'fetch',
            vi.fn((_url, options) =>
                new Promise((_resolve, reject) => {
                    options.signal.addEventListener('abort', () =>
                        reject(
                            new DOMException(
                                'Aborted',
                                'AbortError',
                            ),
                        ),
                    )
                }),
            ),
        )
        const controller = new AbortController()
        const pending = fetchMarketTokens({
            chainId: 56,
            query: 'usdt',
            signal: controller.signal,
            apiBaseUrl: 'http://localhost:3001',
        })
        controller.abort()
        await expect(pending).rejects.toMatchObject({
            name: 'AbortError',
        })
        expect(storage.setItem).not.toHaveBeenCalled()
    })

    it('rejects stale request sequences before they update hook state', () => {
        const controller = new AbortController()
        expect(
            isLatestMarketTokenRequest({
                sequence: 1,
                currentSequence: 2,
                signal: controller.signal,
            }),
        ).toBe(false)
        expect(
            isLatestMarketTokenRequest({
                sequence: 2,
                currentSequence: 2,
                signal: controller.signal,
            }),
        ).toBe(true)
        controller.abort()
        expect(
            isLatestMarketTokenRequest({
                sequence: 2,
                currentSequence: 2,
                signal: controller.signal,
            }),
        ).toBe(false)
    })

    it('orders icon candidates and provides a stable letter fallback', () => {
        expect(
            getTokenLogoCandidates({
                symbol: 'USDT',
                logoURI: 'https://images.example/coingecko.png',
                iconUrl: 'https://images.example/coingecko.png',
                logoCandidates: [
                    'https://images.example/coingecko.png',
                    'https://images.example/trust.png',
                    'https://images.example/alchemy.png',
                ],
            }),
        ).toEqual([
            'https://images.example/coingecko.png',
            'https://images.example/trust.png',
            'https://images.example/alchemy.png',
        ])
        expect(getTokenLogoCandidates({ symbol: 'NoLogo' })).toEqual([])
        expect(getTokenFallbackLetter({ symbol: 'NoLogo' })).toBe('N')
    })

    it('keeps positive wallet tokens outside the top catalog', () => {
        const catalog = [
            { chainId: 56, address: '0x0000000000000000000000000000000000000001', symbol: 'ONE' },
        ]
        const walletOnly = {
            chainId: 56,
            address: '0x0000000000000000000000000000000000000002',
            symbol: 'XAUT',
            formattedBalance: '1.5',
            rawBalance: '1500000',
        }
        const merged = mergeWalletBalances(catalog, [walletOnly])
        expect(merged).toHaveLength(2)
        expect(merged[1]).toMatchObject({ symbol: 'XAUT', balance: '1.5' })
    })

    it('uses exact addresses so a duplicate symbol cannot impersonate a token', () => {
        const tokens = mergeWalletBalances([], [
            {
                chainId: 56,
                address: '0x0000000000000000000000000000000000000001',
                symbol: 'USDT',
                formattedBalance: '10',
            },
            {
                chainId: 56,
                address: '0x0000000000000000000000000000000000000002',
                symbol: 'USDT',
                formattedBalance: '1',
            },
        ])
        expect(tokens).toHaveLength(2)
        expect(new Set(tokens.map((token) => token.address)).size).toBe(2)
    })

    it('merges wallet balances by chain and address only', () => {
        const catalog = [
            {
                chainId: 56,
                address: '0x0000000000000000000000000000000000000001',
                symbol: 'SAME',
            },
            {
                chainId: 56,
                address: '0x0000000000000000000000000000000000000002',
                symbol: 'SAME',
            },
        ]
        const merged = mergeWalletBalances(catalog, [
            {
                chainId: 56,
                address: '0x0000000000000000000000000000000000000002',
                formattedBalance: '3.5',
                rawBalance: '3500000000000000000',
                valueUSD: null,
                priceUSD: null,
            },
        ])

        expect(merged[0].balance).toBeUndefined()
        expect(merged[1].balance).toBe('3.5')
    })

    it('admits only exact recognized active market tokens', () => {
        const token = (index, overrides = {}) => ({
            chainId: index === 9 ? 1 : 56,
            address: `0x${index.toString(16).padStart(40, '0')}`,
            name: `Token ${index}`,
            symbol: index === 9 ? 'SAFE' : `T${index}`,
            decimals: 18,
            verificationStatus: 'established',
            verificationReasons: [
                'coingecko-exact-contract',
                'minimum-liquidity-met',
            ],
            volume24hUsd: 100,
            liquidityUsd: 1000,
            visibility: 'primary',
            possibleSpam: false,
            securityStatus: 'low',
            ...overrides,
        })
        const candidates = [
            token(1),
            token(2, { verificationStatus: 'recognized' }),
            token(3, { verificationStatus: 'unverified' }),
            token(4, { verificationReasons: ['symbol-match', 'minimum-liquidity-met'] }),
            token(5, { possibleSpam: true }),
            token(6, { visibility: 'hidden' }),
            token(7, { securityStatus: 'blocked' }),
            token(8, { volume24hUsd: null }),
            token(9, { liquidityUsd: 0 }),
        ]
        expect(filterEligibleMarketTokens(candidates).map((item) => item.address))
            .toEqual([candidates[0].address, candidates[1].address])
        expect(filterEligibleMarketTokens([
            token(10, { symbol: 'SAFE' }),
            token(9, { verificationStatus: 'unverified' }),
        ])).toHaveLength(1)
    })

    it('requires real activity for the curated official XAUt identity', () => {
        const xaut = {
            chainId: 56,
            address: '0x21caef8a43163eea865baee23b9c2e327696a3bf',
            name: 'Tether Gold',
            symbol: 'XAUt',
            decimals: 6,
            verificationStatus: 'established',
            verificationReasons: [
                'curated-official-contract',
                'minimum-liquidity-met',
            ],
            volume24hUsd: 1_000_000,
            liquidityUsd: 500_000,
            visibility: 'primary',
            possibleSpam: false,
            securityStatus: 'low',
        }
        expect(filterEligibleMarketTokens([xaut])).toEqual([xaut])
        expect(filterEligibleMarketTokens([{ ...xaut, volume24hUsd: null }]))
            .toEqual([])
        expect(filterEligibleMarketTokens([{ ...xaut, liquidityUsd: 0 }]))
            .toEqual([])
    })

    it('canonicalizes the Celo native alias without summing duplicate balances', () => {
        const nativeAddress = '0x0000000000000000000000000000000000000000'
        const celoAlias = '0x471ece3750da237f93b8e339c536989b8978a438'
        const base = {
            classificationVersion: 4,
            chainId: 42220,
            name: 'Celo',
            symbol: 'CELO',
            decimals: 18,
            rawBalance: '2000000000000000000',
            formattedBalance: '2',
            balance: '2',
            recognitionStatus: 'established',
            spamStatus: 'clean',
            possibleSpam: false,
            verifiedContract: true,
            securityStatus: 'trusted',
            visibility: 'primary',
            priceConfidence: 'market',
        }
        expect(getCanonicalTokenIdentity({ chainId: 42220, address: nativeAddress }))
            .toBe('42220:0x0000000000000000000000000000000000000000')
        expect(getCanonicalTokenIdentity({ chainId: 42220, address: celoAlias }))
            .toBe('42220:0x0000000000000000000000000000000000000000')

        const merged = mergeWalletBalances([], [
            { ...base, address: celoAlias, isNative: false, marketPriceUSD: '0.75' },
            { ...base, address: nativeAddress, isNative: true, marketPriceUSD: null },
        ])
        expect(merged).toHaveLength(1)
        expect(merged[0]).toMatchObject({
            address: nativeAddress,
            name: 'Celo',
            symbol: 'CELO',
            balance: '2',
            marketPriceUSD: '0.75',
            isNative: true,
        })
        expect(getCanonicalTokenIdentity({ chainId: 1, address: celoAlias }))
            .toBe(`1:${celoAlias}`)
    })
})
