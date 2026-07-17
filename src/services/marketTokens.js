import { isTokenDiscoveryChainId } from '../web3/curatedEvmChains.js'

export const MARKET_TOKEN_CACHE_PREFIX =
    'pistachioswap:market-tokens:v4:'

const LEGACY_CACHE_PREFIXES = [
    'pistachioswap:market-tokens:v1:',
    'pistachioswap:market-tokens:v2:',
    'pistachioswap:market-tokens:v3:',
]

let legacyCacheMigrated = false

const CATALOG_CACHE_TTL_MS =
    10 * 60 * 1000

const PARTIAL_CATALOG_CACHE_TTL_MS =
    60 * 1000

const SEARCH_CACHE_TTL_MS =
    5 * 60 * 1000

const MAX_BROWSER_CACHE_ENTRIES = 25
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/

function normalizeSearch(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
}

export function normalizeMarketChainScope(value) {
    if (String(value).trim().toLowerCase() === 'all') return 'all'
    const chainId = Number(value)
    if (!Number.isSafeInteger(chainId) || !isTokenDiscoveryChainId(chainId)) {
        throw new Error('A valid token-discovery chain is required')
    }
    return chainId
}

export function getCanonicalTokenIdentity(token) {
    const chainId = Number(token?.chainId)
    const address = String(token?.address ?? '').trim()
    if (
        !Number.isSafeInteger(chainId) ||
        chainId <= 0 ||
        !EVM_ADDRESS_PATTERN.test(address)
    ) {
        return null
    }
    return `${chainId}:${address.toLowerCase()}`
}

export function getMarketTokenCacheKey({
                         chainId,
                         query,
                         limit,
                     }) {
    return (
        MARKET_TOKEN_CACHE_PREFIX +
        encodeURIComponent(
            JSON.stringify({
                chainId: normalizeMarketChainScope(chainId),
                query: normalizeSearch(query),
                limit,
            }),
        )
    )
}

function readCacheEntry(key) {
    if (typeof window === 'undefined') {
        return null
    }

    try {
        const rawValue =
            window.localStorage.getItem(key)

        if (!rawValue) {
            return null
        }

        const entry = JSON.parse(rawValue)

        if (
            !entry ||
            typeof entry.cachedAt !== 'number' ||
            !entry.payload ||
            !Array.isArray(entry.payload.tokens) ||
            entry.payload.tokens.some(
                (token) => getCanonicalTokenIdentity(token) === null,
            )
        ) {
            window.localStorage.removeItem(key)
            return null
        }

        return entry
    } catch {
        return null
    }
}

export function migrateLegacyMarketTokenCache() {
    if (
        legacyCacheMigrated ||
        typeof window === 'undefined'
    ) {
        return
    }

    legacyCacheMigrated = true

    try {
        for (
            let index = window.localStorage.length - 1;
            index >= 0;
            index -= 1
        ) {
            const key = window.localStorage.key(index)

            if (
                key &&
                LEGACY_CACHE_PREFIXES.some((prefix) =>
                    key.startsWith(prefix),
                )
            ) {
                window.localStorage.removeItem(key)
            }
        }
    } catch {
        // Storage can be unavailable in private mode.
    }
}

function pruneBrowserCache() {
    if (typeof window === 'undefined') {
        return
    }

    try {
        const entries = []

        for (
            let index = 0;
            index < window.localStorage.length;
            index += 1
        ) {
            const key =
                window.localStorage.key(index)

            if (
                !key ||
                !key.startsWith(MARKET_TOKEN_CACHE_PREFIX)
            ) {
                continue
            }

            const entry = readCacheEntry(key)

            if (!entry) {
                continue
            }

            entries.push({
                key,
                cachedAt: entry.cachedAt,
            })
        }

        entries.sort(
            (left, right) =>
                right.cachedAt - left.cachedAt,
        )

        for (
            const entry of entries.slice(
            MAX_BROWSER_CACHE_ENTRIES,
        )
            ) {
            window.localStorage.removeItem(
                entry.key,
            )
        }
    } catch {
        // Storage can be unavailable in private mode.
    }
}

function writeCacheEntry(key, payload) {
    if (typeof window === 'undefined') {
        return
    }

    if (!Array.isArray(payload?.tokens) || payload.tokens.length === 0) {
        return
    }

    try {
        window.localStorage.setItem(
            key,
            JSON.stringify({
                cachedAt: Date.now(),
                payload,
            }),
        )

        pruneBrowserCache()
    } catch {
        // Ignore quota and privacy-mode failures.
    }
}

export function clearMarketTokenCache() {
    if (typeof window === 'undefined') {
        return
    }

    for (
        let index =
            window.localStorage.length - 1;
        index >= 0;
        index -= 1
    ) {
        const key =
            window.localStorage.key(index)

        if (key?.startsWith(MARKET_TOKEN_CACHE_PREFIX)) {
            window.localStorage.removeItem(key)
        }
    }
}

export async function fetchMarketTokens({
                                            chainId = 56,
                                            query = '',
                                            signal,
                                            forceRefresh = false,

                                            apiBaseUrl =
                                                import.meta.env.VITE_API_BASE_URL ??
                                                'http://localhost:3001',
                                        } = {}) {
    migrateLegacyMarketTokenCache()

    const normalizedQuery =
        normalizeSearch(query)
    const chainScope = normalizeMarketChainScope(chainId)

    const limit =
        normalizedQuery.length > 0
            ? 20
            : chainScope === 'all'
                ? 200
                : 100

    const cacheKey = getMarketTokenCacheKey({
        chainId: chainScope,
        query: normalizedQuery,
        limit,
    })

    const cachedEntry =
        readCacheEntry(cacheKey)

    const cacheTtlMs = normalizedQuery
        ? SEARCH_CACHE_TTL_MS
        : cachedEntry?.payload?.stale ||
            cachedEntry?.payload?.metadata?.providerPartial
          ? PARTIAL_CATALOG_CACHE_TTL_MS
          : CATALOG_CACHE_TTL_MS

    const cacheIsValid =
        cachedEntry &&
        Date.now() - cachedEntry.cachedAt <
        cacheTtlMs

    if (
        !normalizedQuery &&
        cacheIsValid &&
        !forceRefresh
    ) {
        return {
            ...cachedEntry.payload,
            browserCache: 'hit',
        }
    }

    const baseUrl =
        apiBaseUrl.replace(/\/+$/, '')

    const url = new URL(
        `${baseUrl}/v1/market-tokens`,
    )

    url.searchParams.set(
        'chainId',
        String(chainScope),
    )

    url.searchParams.set(
        'limit',
        String(limit),
    )

    if (normalizedQuery) {
        url.searchParams.set(
            'q',
            normalizedQuery,
        )
    }

    const response = await fetch(
        url.toString(),
        {
            method: 'GET',
            headers: {
                accept: 'application/json',
            },
            signal,
        },
    )

    if (!response.ok) {
        throw new Error(
            `Token request failed with ${response.status}`,
        )
    }

    const payload = await response.json()

    if (!Array.isArray(payload.tokens)) {
        throw new Error(
            'Backend returned an invalid token list',
        )
    }
    if (payload.tokens.some((token) => getCanonicalTokenIdentity(token) === null)) {
        throw new Error('Backend returned a malformed token identity')
    }

    writeCacheEntry(cacheKey, payload)

    return {
        ...payload,
        browserCache:
            normalizedQuery && cacheIsValid
                ? 'refreshed'
                : 'miss',
    }
}
