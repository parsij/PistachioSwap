import { useEffect, useMemo, useState } from 'react'

export const TOKEN_CATALOG_CACHE_VERSION = 'pistachio-token-catalog-v3'
export const TOKEN_CATALOG_FEATURED_CACHE_PREFIX =
    `${TOKEN_CATALOG_CACHE_VERSION}:featured:`
export const TOKEN_CATALOG_FULL_CACHE_PREFIX =
    `${TOKEN_CATALOG_CACHE_VERSION}:all:`
export const LEGACY_UNISWAP_VOLUME_TOKEN_CACHE_KEY =
    'pistachioswap:token-catalog:v1:all'

const memoryCache = new Map()
const pending = new Map()

function cacheKey(mode, chainId) {
    return `${mode === 'all' ? TOKEN_CATALOG_FULL_CACHE_PREFIX : TOKEN_CATALOG_FEATURED_CACHE_PREFIX}${chainId}`
}

function validCatalog(payload, chainId) {
    return payload?.schemaVersion === 1 &&
        Array.isArray(payload.tokens) &&
        payload.tokens.every((token) => Number(token.chainId) === Number(chainId))
}

function readStoredCatalog(mode, chainId) {
    const key = cacheKey(mode, chainId)
    if (memoryCache.has(key)) return memoryCache.get(key)
    try {
        const payload = JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null')
        if (validCatalog(payload, chainId)) {
            memoryCache.set(key, payload)
            return payload
        }
    } catch {
        return null
    }
    return null
}

function writeStoredCatalog(mode, chainId, payload) {
    if (!validCatalog(payload, chainId)) return
    const key = cacheKey(mode, chainId)
    memoryCache.set(key, payload)
    try {
        globalThis.localStorage?.setItem(key, JSON.stringify(payload))
    } catch {
        // Storage quota or privacy mode should not block the selector.
    }
}

function matches(token, query) {
    if (!query) return true
    return [
        token?.name,
        token?.symbol,
        token?.sourceName,
        token?.sourceSymbol,
        ...(Array.isArray(token?.searchAliases) ? token.searchAliases : []),
        token?.address,
    ].some((value) => String(value ?? '').toLowerCase().includes(query))
}

function rankScore(token, query) {
    if (!query) return 0
    const address = String(token?.address ?? '').toLowerCase()
    const symbol = String(token?.symbol ?? '').toLowerCase()
    const sourceSymbol = String(token?.sourceSymbol ?? '').toLowerCase()
    const name = String(token?.name ?? '').toLowerCase()
    const aliases = Array.isArray(token?.searchAliases)
        ? token.searchAliases.map((alias) => String(alias).toLowerCase())
        : []
    if (address === query) return 100
    if (symbol === query) return 90
    if (aliases.includes(query)) return 80
    if (sourceSymbol === query) return 70
    if (symbol.startsWith(query)) return 60
    if (aliases.some((alias) => alias.startsWith(query))) return 50
    if (name.startsWith(query)) return 40
    return token?.tokenCatalogClass === 'pool-vault-receipt' ? 10 : 20
}

async function fetchCatalog(apiBaseUrl, chainId, mode, signal) {
    const key = cacheKey(mode, chainId)
    const cached = readStoredCatalog(mode, chainId)
    if (cached && mode === 'all') return cached
    if (!pending.has(key)) {
        const url = new URL(`${apiBaseUrl.replace(/\/+$/, '')}/v1/token-catalog`)
        url.searchParams.set('chainId', String(chainId))
        url.searchParams.set('mode', mode)
        url.searchParams.set('limit', mode === 'all' ? '6000' : '20')
        pending.set(key, fetch(url, {
            headers: { accept: 'application/json' },
            cache: 'default',
            signal,
        }).then(async (response) => {
            if (!response.ok) throw new Error(`Token catalog failed with ${response.status}`)
            const payload = await response.json()
            if (!validCatalog(payload, chainId)) throw new Error('Token catalog returned invalid data')
            writeStoredCatalog(mode, chainId, payload)
            return payload
        }).finally(() => {
            pending.delete(key)
        }))
    }
    return pending.get(key)
}

export function useTokenCatalog({
    chainId = 56,
    search = '',
    enabled = true,
    apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001',
} = {}) {
    const numericChainId = Number(chainId)
    const storedFeatured = useMemo(() =>
        enabled && Number.isSafeInteger(numericChainId)
            ? readStoredCatalog('featured', numericChainId)
            : null, [enabled, numericChainId])
    const storedFull = useMemo(() =>
        enabled && Number.isSafeInteger(numericChainId)
            ? readStoredCatalog('all', numericChainId)
            : null, [enabled, numericChainId])
    const [state, setState] = useState({
        featuredTokens: storedFeatured?.tokens ?? [],
        fullTokens: storedFull?.tokens ?? [],
        loading: enabled && !storedFeatured,
        error: null,
        partial: false,
        stale: false,
        schemaVersion: storedFeatured?.schemaVersion ?? storedFull?.schemaVersion ?? null,
    })

    useEffect(() => {
        if (!enabled || !Number.isSafeInteger(numericChainId)) {
            setState({
                featuredTokens: [], fullTokens: [], loading: false, error: null,
                partial: false, stale: false, schemaVersion: null,
            })
            return undefined
        }
        const controller = new AbortController()
        const featured = readStoredCatalog('featured', numericChainId)
        const full = readStoredCatalog('all', numericChainId)
        setState({
            featuredTokens: featured?.tokens ?? [],
            fullTokens: full?.tokens ?? [],
            loading: !featured,
            error: null,
            partial: false,
            stale: false,
            schemaVersion: featured?.schemaVersion ?? full?.schemaVersion ?? null,
        })
        fetchCatalog(apiBaseUrl, numericChainId, 'featured', controller.signal)
            .then((payload) => {
                if (controller.signal.aborted) return
                setState((current) => ({
                    ...current,
                    featuredTokens: payload.tokens,
                    loading: false,
                    error: null,
                    schemaVersion: payload.schemaVersion,
                }))
            })
            .catch((error) => {
                if (controller.signal.aborted || error?.name === 'AbortError') return
                setState((current) => ({
                    ...current,
                    loading: false,
                    error: current.featuredTokens.length ? null : 'Token catalog is temporarily unavailable.',
                }))
            })
        fetchCatalog(apiBaseUrl, numericChainId, 'all', controller.signal)
            .then((payload) => {
                if (controller.signal.aborted) return
                setState((current) => ({
                    ...current,
                    fullTokens: payload.tokens,
                    schemaVersion: payload.schemaVersion,
                }))
            })
            .catch(() => {
                // Full-chain search hydration is opportunistic; featured tokens remain usable.
            })
        return () => controller.abort()
    }, [apiBaseUrl, enabled, numericChainId])

    const normalizedSearch = search.trim().toLowerCase()
    const sourceTokens = normalizedSearch && state.fullTokens.length > 0
        ? state.fullTokens
        : state.featuredTokens
    const tokens = useMemo(() => sourceTokens
        .filter((token) => matches(token, normalizedSearch))
        .sort((left, right) =>
            rankScore(right, normalizedSearch) - rankScore(left, normalizedSearch) ||
            Number(left.featuredRank ?? 9999) - Number(right.featuredRank ?? 9999) ||
            Number(left.rank ?? 999999) - Number(right.rank ?? 999999) ||
            String(left.assetId ?? '').localeCompare(String(right.assetId ?? ''))),
    [normalizedSearch, sourceTokens])

    return {
        tokens,
        featuredTokens: state.featuredTokens,
        fullTokens: state.fullTokens,
        count: tokens.length,
        loading: state.loading,
        error: state.error,
        partial: state.partial,
        stale: state.stale,
        schemaVersion: state.schemaVersion,
    }
}

export function clearTokenCatalogCache() {
    memoryCache.clear()
    pending.clear()
    try {
        for (let index = globalThis.localStorage?.length ?? 0; index > 0; index -= 1) {
            const key = globalThis.localStorage?.key(index - 1)
            if (key?.startsWith(TOKEN_CATALOG_CACHE_VERSION)) {
                globalThis.localStorage?.removeItem(key)
            }
        }
    } catch {
        // Ignore storage failures in tests and private browsing.
    }
}
