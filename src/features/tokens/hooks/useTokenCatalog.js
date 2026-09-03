import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'

import { apiBaseUrl as defaultApiBaseUrl } from '../../../lib/apiBaseUrl.js'
import { interpretTokenSearchQuery } from '../model/tokenSearchQuery.js'

export const TOKEN_CATALOG_CACHE_VERSION = 'pistachio-token-catalog-v5'
export const TOKEN_CATALOG_FEATURED_CACHE_PREFIX =
    `${TOKEN_CATALOG_CACHE_VERSION}:featured:`
export const TOKEN_CATALOG_FULL_CACHE_PREFIX =
    `${TOKEN_CATALOG_CACHE_VERSION}:browse:`
export const LEGACY_UNISWAP_VOLUME_TOKEN_CACHE_KEY =
    'pistachioswap:token-catalog:v1:all'

export const TOKEN_CATALOG_PAGE_SIZE = 30
export const TOKEN_CATALOG_SEARCH_LIMIT = 20
export const TOKEN_CATALOG_BROWSER_CACHE_LIMIT = 90
export const TOKEN_CATALOG_ALL_FEATURED_LIMIT = 48

const SEARCH_DEBOUNCE_MS = 250
const LOAD_MORE_COOLDOWN_MS = 350

const memoryCache = new Map()
const pending = new Map()
const loadMoreListeners = new Map()

function normalizeScope(chainId) {
    if (String(chainId).trim().toLowerCase() === 'all') return 'all'
    const numericChainId = Number(chainId)
    return Number.isSafeInteger(numericChainId) && numericChainId > 0
        ? numericChainId
        : null
}

function sameScope(left, right) {
    return String(left) === String(right)
}

function cacheKey(mode, scope) {
    return `${mode === 'all' ? TOKEN_CATALOG_FULL_CACHE_PREFIX : TOKEN_CATALOG_FEATURED_CACHE_PREFIX}${scope}`
}

function tokenIdentity(token) {
    const chainId = Number(token?.chainId)
    const address = String(token?.address ?? '').trim().toLowerCase()
    if (!Number.isSafeInteger(chainId) || chainId <= 0 || !/^0x[a-f0-9]{40}$/.test(address)) {
        return null
    }
    return `${chainId}:${address}`
}

function mergeTokens(...groups) {
    const merged = new Map()
    for (const group of groups) {
        for (const token of group ?? []) {
            const identity = tokenIdentity(token)
            if (!identity) continue
            merged.set(identity, { ...(merged.get(identity) ?? {}), ...token })
        }
    }
    return [...merged.values()]
}

function validCatalog(payload, scope) {
    return payload?.schemaVersion === 1 &&
        Array.isArray(payload.tokens) &&
        payload.tokens.every((token) => {
            if (!tokenIdentity(token)) return false
            return scope === 'all' || Number(token.chainId) === Number(scope)
        })
}

function readStoredCatalog(mode, scope) {
    const key = cacheKey(mode, scope)
    if (memoryCache.has(key)) return memoryCache.get(key)
    try {
        const payload = JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null')
        if (validCatalog(payload, scope)) {
            memoryCache.set(key, payload)
            return payload
        }
        globalThis.localStorage?.removeItem(key)
    } catch {
        return null
    }
    return null
}

function writeStoredCatalog(mode, scope, payload) {
    if (!validCatalog(payload, scope)) return
    const key = cacheKey(mode, scope)
    const storedPayload = mode === 'all'
        ? {
            ...payload,
            tokens: payload.tokens.slice(0, TOKEN_CATALOG_BROWSER_CACHE_LIMIT),
        }
        : payload
    memoryCache.set(key, storedPayload)
    try {
        globalThis.localStorage?.setItem(key, JSON.stringify(storedPayload))
    } catch {
        // Storage quota or privacy mode should not block the selector.
    }
}

async function fetchJson(url, key, signal) {
    if (!pending.has(key)) {
        pending.set(key, fetch(url, {
            headers: { accept: 'application/json' },
            cache: 'default',
            signal,
        }).then(async (response) => {
            if (!response.ok) throw new Error(`Token catalog failed with ${response.status}`)
            return response.json()
        }).finally(() => pending.delete(key)))
    }
    return pending.get(key)
}

function catalogUrl(apiBaseUrl, scope) {
    const url = new URL(
        `${apiBaseUrl.replace(/\/+$/, '')}/v1/token-catalog`,
        globalThis.location?.origin,
    )
    url.searchParams.set('chainId', String(scope))
    return url
}

async function fetchFeaturedCatalog(apiBaseUrl, scope) {
    const url = catalogUrl(apiBaseUrl, scope)
    url.searchParams.set('mode', 'featured')
    url.searchParams.set(
        'limit',
        String(scope === 'all' ? TOKEN_CATALOG_ALL_FEATURED_LIMIT : 20),
    )
    const payload = await fetchJson(url, `featured:${scope}`)
    if (!validCatalog(payload, scope)) throw new Error('Token catalog returned invalid data')
    writeStoredCatalog('featured', scope, payload)
    return payload
}

async function fetchCatalogPage(apiBaseUrl, chainId, cursor) {
    const url = catalogUrl(apiBaseUrl, chainId)
    url.searchParams.set('mode', 'all')
    url.searchParams.set('pageSize', String(TOKEN_CATALOG_PAGE_SIZE))
    if (cursor) url.searchParams.set('cursor', cursor)
    const key = `page:${chainId}:${cursor ?? 'first'}`
    const payload = await fetchJson(url, key)
    if (!validCatalog(payload, chainId)) throw new Error('Token catalog returned invalid data')
    return payload
}

async function fetchCatalogSearch(apiBaseUrl, scope, search, signal) {
    const url = catalogUrl(apiBaseUrl, scope)
    url.searchParams.set('mode', 'all')
    url.searchParams.set('search', search)
    url.searchParams.set('limit', String(TOKEN_CATALOG_SEARCH_LIMIT))
    const payload = await fetchJson(url, `search:${scope}:${search}`, signal)
    if (!validCatalog(payload, scope)) throw new Error('Token catalog returned invalid data')
    return payload
}

function addLoadMoreListener(chainId, listener) {
    const key = Number(chainId)
    const listeners = loadMoreListeners.get(key) ?? new Set()
    listeners.add(listener)
    loadMoreListeners.set(key, listeners)
    return () => {
        listeners.delete(listener)
        if (listeners.size === 0) loadMoreListeners.delete(key)
    }
}

export function requestMoreTokenCatalog(chainId) {
    const numericChainId = Number(chainId)
    if (!Number.isSafeInteger(numericChainId)) return
    const listeners = loadMoreListeners.get(numericChainId)
    if (!listeners) return
    for (const listener of listeners) listener()
}

export function useTokenCatalog({
    chainId = 56,
    search = '',
    enabled = true,
    apiBaseUrl = defaultApiBaseUrl,
} = {}) {
    const scope = normalizeScope(chainId)
    const interpretedSearch = useMemo(() => interpretTokenSearchQuery({
        chainId: scope ?? chainId,
        query: search,
    }), [chainId, scope, search])
    const searchScope = interpretedSearch.chainId
    const normalizedSearch = interpretedSearch.query
    const canBrowsePages = typeof scope === 'number'
    const storedFeatured = useMemo(() =>
        enabled && scope !== null
            ? readStoredCatalog('featured', scope)
            : null, [enabled, scope])
    const storedBrowse = useMemo(() =>
        enabled && canBrowsePages
            ? readStoredCatalog('all', scope)
            : null, [canBrowsePages, enabled, scope])
    const [state, setState] = useState({
        featuredTokens: storedFeatured?.tokens ?? [],
        browseTokens: storedBrowse?.tokens ?? [],
        searchTokens: [],
        loading: enabled && scope !== null && !storedFeatured,
        loadingMore: false,
        searchLoading: false,
        error: null,
        pageError: null,
        schemaVersion: storedFeatured?.schemaVersion ?? storedBrowse?.schemaVersion ?? null,
        nextCursor: storedBrowse?.nextCursor ?? null,
        cacheResumeCursor: storedBrowse?.nextCursor ?? null,
        hasMore: canBrowsePages && storedBrowse?.hasMore !== false,
        totalCount: storedBrowse?.diagnostics?.totalForChain ?? null,
    })
    const stateRef = useRef(state)
    const activeScopeRef = useRef(scope)
    const lastLoadMoreAtRef = useRef(0)

    useEffect(() => {
        stateRef.current = state
    }, [state])

    const appendPage = useCallback((payload) => {
        if (typeof scope !== 'number') return
        setState((current) => {
            const browseTokens = mergeTokens(current.browseTokens, payload.tokens)
            const cacheResumeCursor = browseTokens.length <= TOKEN_CATALOG_BROWSER_CACHE_LIMIT
                ? payload.nextCursor
                : current.cacheResumeCursor
            const next = {
                ...current,
                browseTokens,
                loadingMore: false,
                pageError: null,
                schemaVersion: payload.schemaVersion,
                nextCursor: payload.nextCursor ?? null,
                cacheResumeCursor,
                hasMore: payload.hasMore === true,
                totalCount: payload.diagnostics?.totalForChain ?? current.totalCount,
            }
            writeStoredCatalog('all', scope, {
                ...payload,
                tokens: browseTokens,
                nextCursor: cacheResumeCursor,
                hasMore: cacheResumeCursor !== null &&
                    Number(payload.diagnostics?.totalForChain ?? browseTokens.length) > TOKEN_CATALOG_BROWSER_CACHE_LIMIT,
            })
            return next
        })
    }, [scope])

    const loadMore = useCallback(async () => {
        if (!enabled || typeof scope !== 'number') return
        const current = stateRef.current
        const now = Date.now()
        if (current.loadingMore || !current.hasMore || now - lastLoadMoreAtRef.current < LOAD_MORE_COOLDOWN_MS) {
            return
        }
        lastLoadMoreAtRef.current = now
        setState((value) => ({ ...value, loadingMore: true, pageError: null }))
        try {
            const payload = await fetchCatalogPage(apiBaseUrl, scope, current.nextCursor)
            if (!sameScope(activeScopeRef.current, scope)) return
            appendPage(payload)
        } catch (error) {
            if (!sameScope(activeScopeRef.current, scope)) return
            setState((value) => ({
                ...value,
                loadingMore: false,
                pageError: error instanceof Error ? error.message : 'More tokens could not be loaded.',
            }))
        }
    }, [apiBaseUrl, appendPage, enabled, scope])

    useEffect(() => {
        if (typeof scope !== 'number') return undefined
        return addLoadMoreListener(scope, loadMore)
    }, [loadMore, scope])

    useEffect(() => {
        activeScopeRef.current = scope
        lastLoadMoreAtRef.current = 0
        if (!enabled || scope === null) {
            setState({
                featuredTokens: [], browseTokens: [], searchTokens: [], loading: false,
                loadingMore: false, searchLoading: false, error: null, pageError: null,
                schemaVersion: null, nextCursor: null, cacheResumeCursor: null,
                hasMore: false, totalCount: null,
            })
            return undefined
        }

        let cancelled = false
        const featured = readStoredCatalog('featured', scope)
        const browse = canBrowsePages ? readStoredCatalog('all', scope) : null
        setState({
            featuredTokens: featured?.tokens ?? [],
            browseTokens: browse?.tokens ?? [],
            searchTokens: [],
            loading: !featured,
            loadingMore: false,
            searchLoading: false,
            error: null,
            pageError: null,
            schemaVersion: featured?.schemaVersion ?? browse?.schemaVersion ?? null,
            nextCursor: browse?.nextCursor ?? null,
            cacheResumeCursor: browse?.nextCursor ?? null,
            hasMore: canBrowsePages && browse?.hasMore !== false,
            totalCount: browse?.diagnostics?.totalForChain ?? null,
        })

        fetchFeaturedCatalog(apiBaseUrl, scope)
            .then((payload) => {
                if (cancelled || !sameScope(activeScopeRef.current, scope)) return
                setState((current) => ({
                    ...current,
                    featuredTokens: payload.tokens,
                    loading: false,
                    error: null,
                    schemaVersion: payload.schemaVersion,
                    totalCount: scope === 'all'
                        ? payload.diagnostics?.totalForChain ?? current.totalCount
                        : current.totalCount,
                }))
            })
            .catch(() => {
                if (cancelled || !sameScope(activeScopeRef.current, scope)) return
                setState((current) => ({
                    ...current,
                    loading: false,
                    error: current.featuredTokens.length ? null : 'Token catalog is temporarily unavailable.',
                }))
            })

        if (canBrowsePages && !browse?.tokens?.length) {
            setState((current) => ({ ...current, loadingMore: true }))
            fetchCatalogPage(apiBaseUrl, scope, null)
                .then((payload) => {
                    if (cancelled || !sameScope(activeScopeRef.current, scope)) return
                    appendPage(payload)
                })
                .catch((error) => {
                    if (cancelled || !sameScope(activeScopeRef.current, scope)) return
                    setState((current) => ({
                        ...current,
                        loadingMore: false,
                        pageError: error instanceof Error ? error.message : 'Token catalog page could not be loaded.',
                    }))
                })
        }

        return () => {
            cancelled = true
        }
    }, [apiBaseUrl, appendPage, canBrowsePages, enabled, scope])

    useEffect(() => {
        if (!enabled || scope === null || !normalizedSearch) {
            setState((current) => ({ ...current, searchTokens: [], searchLoading: false }))
            return undefined
        }
        const controller = new AbortController()
        const timeout = setTimeout(() => {
            setState((current) => ({ ...current, searchLoading: true }))
            fetchCatalogSearch(apiBaseUrl, searchScope, normalizedSearch, controller.signal)
                .then((payload) => {
                    if (controller.signal.aborted || !sameScope(activeScopeRef.current, scope)) return
                    setState((current) => ({
                        ...current,
                        searchTokens: payload.tokens.slice(0, TOKEN_CATALOG_SEARCH_LIMIT),
                        searchLoading: false,
                    }))
                })
                .catch((error) => {
                    if (controller.signal.aborted || error?.name === 'AbortError') return
                    setState((current) => ({ ...current, searchLoading: false }))
                })
        }, SEARCH_DEBOUNCE_MS)
        return () => {
            clearTimeout(timeout)
            controller.abort()
        }
    }, [apiBaseUrl, enabled, normalizedSearch, scope, searchScope])

    const browseTokens = useMemo(() => mergeTokens(
        state.featuredTokens,
        state.browseTokens,
    ), [state.browseTokens, state.featuredTokens])
    const tokens = normalizedSearch
        ? state.searchTokens.slice(0, TOKEN_CATALOG_SEARCH_LIMIT)
        : browseTokens

    return {
        tokens,
        featuredTokens: state.featuredTokens,
        fullTokens: state.browseTokens,
        count: tokens.length,
        loading: state.loading || (Boolean(normalizedSearch) && state.searchLoading && tokens.length === 0),
        loadingMore: state.loadingMore,
        hasMore: state.hasMore,
        loadedCount: browseTokens.length,
        totalCount: state.totalCount,
        error: state.error,
        partial: Boolean(state.pageError),
        stale: false,
        schemaVersion: state.schemaVersion,
    }
}

export function clearTokenCatalogCache() {
    memoryCache.clear()
    pending.clear()
    try {
        for (let index = globalThis.localStorage?.length ?? 0; index > 0; index -= 1) {
            const key = globalThis.localStorage?.key(index - 1)
            if (key?.startsWith('pistachio-token-catalog-')) {
                globalThis.localStorage?.removeItem(key)
            }
        }
    } catch {
        // Ignore storage failures in tests and private browsing.
    }
}
