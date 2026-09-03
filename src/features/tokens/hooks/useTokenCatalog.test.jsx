// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    LEGACY_UNISWAP_VOLUME_TOKEN_CACHE_KEY,
    TOKEN_CATALOG_ALL_FEATURED_LIMIT,
    TOKEN_CATALOG_CACHE_VERSION,
    TOKEN_CATALOG_FEATURED_CACHE_PREFIX,
    TOKEN_CATALOG_FULL_CACHE_PREFIX,
    TOKEN_CATALOG_PAGE_SIZE,
    TOKEN_CATALOG_SEARCH_LIMIT,
    clearTokenCatalogCache,
    requestMoreTokenCatalog,
    useTokenCatalog,
} from './useTokenCatalog.js'
import { tokenMatchesSearch } from '../model/tokenSelectorState.js'
import { interpretTokenSearchQuery } from '../model/tokenSearchQuery.js'

const featuredPayload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tokens: [
        { chainId: 56, address: '0x0000000000000000000000000000000000000000', name: 'BNB', symbol: 'BNB', rank: 0 },
        { chainId: 56, address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', name: 'Wrapped BNB', symbol: 'WBNB', rank: 1 },
    ],
}

const allFeaturedPayload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tokens: [
        { chainId: 1, address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', name: 'USD Coin', symbol: 'USDC', rank: 0 },
        { chainId: 56, address: '0x55d398326f99059ff775485246999027b3197955', name: 'Tether USD', symbol: 'USDT', rank: 1 },
        { chainId: 8453, address: '0x4200000000000000000000000000000000000006', name: 'Wrapped Ether', symbol: 'WETH', rank: 2 },
    ],
    diagnostics: { totalForChain: 15097, representedChainCount: 3 },
}

const allSearchPayload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tokens: [
        { chainId: 1, address: '0x1111111111111111111111111111111111111111', name: 'Tether Gold', symbol: 'XAUT', rank: 0 },
        { chainId: 56, address: '0x2222222222222222222222222222222222222222', name: 'Tether Gold', symbol: 'XAUT', rank: 1 },
        { chainId: 42220, address: '0x3333333333333333333333333333333333333333', name: 'Tether Gold', symbol: 'XAUT', rank: 2 },
    ],
    nextCursor: null,
    hasMore: false,
    diagnostics: { totalForChain: 3 },
}

const polygonSearchPayload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tokens: [
        {
            chainId: 137,
            address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
            name: 'USD Coin',
            symbol: 'USDC',
            rank: 0,
        },
    ],
    nextCursor: null,
    hasMore: false,
    diagnostics: { totalForChain: 1 },
}

const firstPagePayload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tokens: [
        ...featuredPayload.tokens,
        { chainId: 56, address: '0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd', name: 'Chainlink', symbol: 'LINK', rank: 2 },
    ],
    nextCursor: 'page-2',
    hasMore: true,
    diagnostics: { totalForChain: 3448 },
}

const secondPagePayload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tokens: [
        { chainId: 56, address: '0x2170ed0880ac9a755fd29b2688956bd959f933f8', name: 'Wrapped Ether', symbol: 'WETH', rank: 3 },
    ],
    nextCursor: 'page-3',
    hasMore: true,
    diagnostics: { totalForChain: 3448 },
}

const searchPayload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tokens: [
        { chainId: 56, address: '0x55d398326f99059ff775485246999027b3197955', name: 'Tether USD', symbol: 'USDT', sourceSymbol: 'BSC-USD', searchAliases: ['USDT', 'Tether USD'], featuredRank: 2, rank: 2 },
        { chainId: 56, address: '0xa9251ca9de909cb71783723713b21e4233fbf1b1', name: 'Aave BNB Smart Chain USDT Pool', symbol: 'ABNBUSDT', tokenCatalogClass: 'pool-vault-receipt', rank: 1 },
    ],
    nextCursor: null,
    hasMore: false,
    diagnostics: { totalForChain: 2 },
}

function response(payload) {
    return {
        ok: true,
        json: async () => payload,
    }
}

describe('useTokenCatalog', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        window.localStorage.clear()
        clearTokenCatalogCache()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        window.localStorage.clear()
        clearTokenCatalogCache()
    })

    it('uses per-chain featured cache and fetches only the first 30-token page', async () => {
        window.localStorage.setItem(
            LEGACY_UNISWAP_VOLUME_TOKEN_CACHE_KEY,
            JSON.stringify({ schemaVersion: 1, tokens: [{ chainId: 1, symbol: 'OLD' }] }),
        )
        window.localStorage.setItem(
            `${TOKEN_CATALOG_FEATURED_CACHE_PREFIX}56`,
            JSON.stringify(featuredPayload),
        )
        vi.stubGlobal('fetch', vi.fn(async (url) =>
            response(url.toString().includes('pageSize=') ? firstPagePayload : featuredPayload)))

        const { result } = renderHook(() => useTokenCatalog({
            chainId: 56,
            search: '',
            apiBaseUrl: 'http://127.0.0.1:3001',
        }))

        expect(result.current.loading).toBe(false)
        expect(result.current.tokens.map((token) => token.symbol)).toEqual(['BNB', 'WBNB'])
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(result.current.tokens.map((token) => token.symbol))
            .toEqual(['BNB', 'WBNB', 'LINK']))
        const urls = fetch.mock.calls.map((call) => call[0].toString())
        expect(urls.every((url) => url.includes('chainId=56'))).toBe(true)
        expect(urls.some((url) => url.includes(`pageSize=${TOKEN_CATALOG_PAGE_SIZE}`))).toBe(true)
        expect(urls.some((url) => url.includes('limit=6000') || url.includes('chainId=all'))).toBe(false)
        expect(window.localStorage.getItem(LEGACY_UNISWAP_VOLUME_TOKEN_CACHE_KEY)).not.toBeNull()
        expect([...Array(window.localStorage.length)].map((_, index) => window.localStorage.key(index)))
            .toContain(`${TOKEN_CATALOG_FULL_CACHE_PREFIX}56`)
    })

    it('loads the next 30-token page only when the selector asks for more', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            const text = url.toString()
            if (text.includes('cursor=page-2')) return response(secondPagePayload)
            if (text.includes('pageSize=')) return response(firstPagePayload)
            return response(featuredPayload)
        }))
        const { result } = renderHook(() => useTokenCatalog({
            chainId: 56,
            search: '',
            apiBaseUrl: 'http://127.0.0.1:3001',
        }))

        await waitFor(() => expect(result.current.tokens.some((token) => token.symbol === 'LINK')).toBe(true))
        expect(fetch).toHaveBeenCalledTimes(2)
        await act(async () => {
            requestMoreTokenCatalog(56)
        })
        await waitFor(() => expect(result.current.tokens.some((token) => token.symbol === 'WETH')).toBe(true))
        expect(fetch).toHaveBeenCalledTimes(3)
    })

    it('debounces full-catalog search and keeps results capped at 20', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            const text = url.toString()
            if (text.includes('search=usdt')) return response(searchPayload)
            if (text.includes('pageSize=')) return response(firstPagePayload)
            return response(featuredPayload)
        }))

        const { result } = renderHook(() => useTokenCatalog({
            chainId: 56,
            search: 'usdt',
            apiBaseUrl: 'http://127.0.0.1:3001',
        }))

        await waitFor(() => expect(result.current.tokens.length).toBeGreaterThan(1))
        expect(result.current.tokens.length).toBeLessThanOrEqual(TOKEN_CATALOG_SEARCH_LIMIT)
        expect(result.current.tokens[0].address).toBe('0x55d398326f99059ff775485246999027b3197955')
        const searchUrl = fetch.mock.calls.find((call) => call[0].toString().includes('search=usdt'))?.[0].toString()
        expect(searchUrl).toContain(`limit=${TOKEN_CATALOG_SEARCH_LIMIT}`)
        expect(searchUrl).not.toContain('limit=6000')
    })

    it('loads a mixed all-chain featured list without paging the full 15k catalog', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response(allFeaturedPayload)))

        const { result } = renderHook(() => useTokenCatalog({
            chainId: 'all',
            search: '',
            apiBaseUrl: 'http://127.0.0.1:3001',
        }))

        await waitFor(() => expect(result.current.tokens).toHaveLength(3))
        const urls = fetch.mock.calls.map((call) => call[0].toString())
        expect(urls).toHaveLength(1)
        expect(urls[0]).toContain('chainId=all')
        expect(urls[0]).toContain('mode=featured')
        expect(urls[0]).toContain(`limit=${TOKEN_CATALOG_ALL_FEATURED_LIMIT}`)
        expect(urls[0]).not.toContain('pageSize=')
        expect(new Set(result.current.tokens.map((token) => token.chainId)).size).toBe(3)
        expect(result.current.hasMore).toBe(false)
    })

    it('searches the backend across every chain and preserves Celo results', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            const text = url.toString()
            return response(text.includes('search=xaut') ? allSearchPayload : allFeaturedPayload)
        }))

        const { result } = renderHook(() => useTokenCatalog({
            chainId: 'all',
            search: 'xaut',
            apiBaseUrl: 'http://127.0.0.1:3001',
        }))

        await waitFor(() => expect(result.current.tokens.some((token) => token.chainId === 42220)).toBe(true))
        expect(result.current.tokens).toHaveLength(3)
        const searchUrl = fetch.mock.calls.find((call) => call[0].toString().includes('search=xaut'))?.[0].toString()
        expect(searchUrl).toContain('chainId=all')
        expect(searchUrl).toContain(`limit=${TOKEN_CATALOG_SEARCH_LIMIT}`)
    })

    it('interprets token and network qualifiers conservatively', () => {
        expect(interpretTokenSearchQuery({ chainId: 'all', query: 'USDC Polygon' }))
            .toMatchObject({ chainId: 137, query: 'usdc', chainQualified: true })
        expect(interpretTokenSearchQuery({ chainId: 'all', query: 'polygon usdc' }))
            .toMatchObject({ chainId: 137, query: 'usdc', chainQualified: true })
        expect(interpretTokenSearchQuery({ chainId: 'all', query: 'usd t bnb' }))
            .toMatchObject({ chainId: 56, query: 'usdt', chainQualified: true })
        expect(interpretTokenSearchQuery({ chainId: 'all', query: 'MATIC' }))
            .toMatchObject({ chainId: 137, query: 'pol', chainQualified: true })
        expect(interpretTokenSearchQuery({ chainId: 56, query: 'usdc polygon' }))
            .toMatchObject({ chainId: 56, query: 'usdc polygon', chainQualified: false })
        expect(interpretTokenSearchQuery({ chainId: 'all', query: 'base protocol' }))
            .toMatchObject({ chainId: 'all', query: 'base protocol', chainQualified: false })
    })

    it('scopes a compound all-chain catalog search to the inferred network', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            const text = url.toString()
            if (text.includes('chainId=137') && text.includes('search=usdc')) {
                return response(polygonSearchPayload)
            }
            return response(allFeaturedPayload)
        }))

        const { result } = renderHook(() => useTokenCatalog({
            chainId: 'all',
            search: 'USDC Polygon',
            apiBaseUrl: 'http://127.0.0.1:3001',
        }))

        await waitFor(() => expect(result.current.tokens[0]?.chainId).toBe(137))
        const searchUrl = fetch.mock.calls
            .map((call) => call[0].toString())
            .find((url) => url.includes('search=usdc'))
        expect(searchUrl).toContain('chainId=137')
        expect(searchUrl).toContain(`limit=${TOKEN_CATALOG_SEARCH_LIMIT}`)
        expect(searchUrl).not.toContain('search=usdc+polygon')
    })

    it('keeps local token filtering aligned with interpreted network searches', () => {
        const polygonUsdc = {
            chainId: 137,
            address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
            name: 'USD Coin',
            symbol: 'USDC',
        }
        const ethereumUsdc = {
            chainId: 1,
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            name: 'USD Coin',
            symbol: 'USDC',
        }
        const polygonPol = {
            chainId: 137,
            address: '0x0000000000000000000000000000000000000000',
            name: 'POL',
            symbol: 'POL',
        }
        const bnbUsdt = {
            chainId: 56,
            address: '0x55d398326f99059ff775485246999027b3197955',
            name: 'Tether USD',
            symbol: 'USDT',
        }

        expect(tokenMatchesSearch(polygonUsdc, 'usdc polygon')).toBe(true)
        expect(tokenMatchesSearch(ethereumUsdc, 'usdc polygon')).toBe(false)
        expect(tokenMatchesSearch(polygonPol, 'matic')).toBe(true)
        expect(tokenMatchesSearch(polygonUsdc, 'matic')).toBe(false)
        expect(tokenMatchesSearch(bnbUsdt, 'usd t bnb')).toBe(true)
    })

    it('ignores the previous cache version', () => {
        window.localStorage.setItem(
            'pistachio-token-catalog-v4:browse:56',
            JSON.stringify(firstPagePayload),
        )
        expect(TOKEN_CATALOG_CACHE_VERSION).toBe('pistachio-token-catalog-v5')
        expect(window.localStorage.getItem(`${TOKEN_CATALOG_FULL_CACHE_PREFIX}56`)).toBeNull()
    })
})
