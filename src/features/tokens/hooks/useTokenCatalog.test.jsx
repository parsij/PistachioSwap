// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    LEGACY_UNISWAP_VOLUME_TOKEN_CACHE_KEY,
    TOKEN_CATALOG_CACHE_VERSION,
    TOKEN_CATALOG_FEATURED_CACHE_PREFIX,
    clearTokenCatalogCache,
    useTokenCatalog,
} from './useTokenCatalog.js'

const featuredPayload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tokens: [
        { chainId: 56, address: '0x0000000000000000000000000000000000000000', name: 'BNB', symbol: 'BNB', rank: 0 },
        { chainId: 56, address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', name: 'Wrapped BNB', symbol: 'WBNB', rank: 1 },
    ],
}

const fullPayload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tokens: [
        ...featuredPayload.tokens,
        { chainId: 56, address: '0x55d398326f99059ff775485246999027b3197955', name: 'Tether USD', symbol: 'USDT', sourceSymbol: 'BSC-USD', searchAliases: ['USDT', 'Tether USD'], featuredRank: 2, rank: 2 },
        { chainId: 56, address: '0xa9251ca9de909cb71783723713b21e4233fbf1b1', name: 'Aave BNB Smart Chain USDT Pool', symbol: 'ABNBUSDT', tokenCatalogClass: 'pool-vault-receipt', rank: 1 },
    ],
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

    it('uses per-chain featured cache and ignores old Uniswap cache keys', async () => {
        window.localStorage.setItem(
            LEGACY_UNISWAP_VOLUME_TOKEN_CACHE_KEY,
            JSON.stringify({ schemaVersion: 1, tokens: [{ chainId: 1, symbol: 'OLD' }] }),
        )
        window.localStorage.setItem(
            `${TOKEN_CATALOG_FEATURED_CACHE_PREFIX}56`,
            JSON.stringify(featuredPayload),
        )
        vi.stubGlobal('fetch', vi.fn(async (url) => ({
            ok: true,
            json: async () => url.toString().includes('mode=all') ? fullPayload : featuredPayload,
        })))

        const { result } = renderHook(() => useTokenCatalog({
            chainId: 56,
            search: '',
            apiBaseUrl: 'http://127.0.0.1:3001',
        }))

        expect(result.current.loading).toBe(false)
        expect(result.current.tokens.map((token) => token.symbol)).toEqual(['BNB', 'WBNB'])
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
        const urls = fetch.mock.calls.map((call) => call[0].toString())
        expect(urls.every((url) => url.includes('chainId=56'))).toBe(true)
        expect(urls.some((url) => url.includes('chainId=all') || url.includes('limit=250'))).toBe(false)
        expect(window.localStorage.getItem(LEGACY_UNISWAP_VOLUME_TOKEN_CACHE_KEY)).not.toBeNull()
        expect([...Array(window.localStorage.length)].map((_, index) => window.localStorage.key(index)))
            .toContain(`${TOKEN_CATALOG_CACHE_VERSION}:all:56`)
    })

    it('searches the complete selected-chain cache locally', async () => {
        window.localStorage.setItem(
            `${TOKEN_CATALOG_FEATURED_CACHE_PREFIX}56`,
            JSON.stringify(featuredPayload),
        )
        window.localStorage.setItem(
            `${TOKEN_CATALOG_CACHE_VERSION}:all:56`,
            JSON.stringify(fullPayload),
        )
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => featuredPayload,
        })))

        const { result } = renderHook(() => useTokenCatalog({
            chainId: 56,
            search: 'usdt',
            apiBaseUrl: 'http://127.0.0.1:3001',
        }))

        await waitFor(() => expect(result.current.tokens.length).toBeGreaterThan(1))
        expect(result.current.tokens[0].address).toBe('0x55d398326f99059ff775485246999027b3197955')
        expect(result.current.tokens.at(-1).tokenCatalogClass).toBe('pool-vault-receipt')
        expect(fetch.mock.calls.every((call) => !call[0].toString().includes('search='))).toBe(true)
    })
})
