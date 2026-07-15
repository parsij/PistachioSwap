import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    fetchMarketTokens,
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
        expect(search).toContain('market-tokens:v4:')
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
                new Response(JSON.stringify({ tokens: [], count: 0 }), {
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
                    tokens: [{ symbol: 'OLD' }],
                    metadata: { providerPartial: true },
                },
            }),
        })
        const fetchMock = vi.fn(async () =>
            new Response(
                JSON.stringify({ tokens: [{ symbol: 'NEW' }], count: 1 }),
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
})
