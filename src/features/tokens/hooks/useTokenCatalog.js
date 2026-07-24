import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'

export const TOKEN_CATALOG_CACHE_VERSION = 'pistachio-token-catalog-v4'
export const TOKEN_CATALOG_FEATURED_CACHE_PREFIX =
    `${TOKEN_CATALOG_CACHE_VERSION}:featured:`
export const TOKEN_CATALOG_FULL_CACHE_PREFIX =
    `${TOKEN_CATALOG_CACHE_VERSION}:browse:`
export const LEGACY_UNISWAP_VOLUME_TOKEN_CACHE_KEY =
    'pistachioswap:token-catalog:v1:all'

export const TOKEN_CATALOG_PAGE_SIZE = 30
export const TOKEN_CATALOG_SEARCH_LIMIT = 20
export const TOKEN_CATALOG_BROWSER_CACHE_LIMIT = 90

const SEARCH_DEBOUNCE_MS = 250
const LOAD_MORE_COOLDOWN_MS = 350

const memoryCache = new Map()
const pending = new Map()
const loadMoreListeners = new Map()

function cacheKey(mode, chainId) {
    return `${mode === 'all' ? TOKEN_CATALOG_FULL_CACHE_PREFIX : TOKEN_CATALOG_FEATURED_CACHE_PREFIX}${chainId}`
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
        globalThis.localStorage?.removeItem(key)
    } catch {
        return null
    }
    return null
}

function writeStoredCatalog(mode, chainId, payload) {
    if (!validCatalog(payload, chainId)) return
    const key = cacheKey(mode, chainId)
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

function catalogUrl(apiBaseUrl, chainId) {
    const url = new URL(`${apiBaseUrl.replace(/\/+$/, '')}/v1/token-catalog`)
    url.searchParams.set('chainId', String(chainId))
    return url
}

async function fetchFeaturedCatalog(apiBaseUrl, chainId) {
    const url = catalogUrl(apiBaseUrl, chainId)
    url.searchParams.set('mode', 'featured')
    url.searchParams.set('limit', '20')
    const payload = await fetchJson(url, `featured:${chainId}`)
    if (!validCatalog(payload, chainId)) throw new Error('Token catalog returned invalid data')
    writeStoredCatalog('featured', chainId, payload)
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

async function fetchCatalogSearch(apiBaseUrl, chainId, search, signal) {
    const url = catalogUrl(apiBaseUrl, chainId)
    url.searchParams.set('mode', 'all')
    url.searchParams.set('search', search)
    url.searchParams.set('limit', String(TOKEN_CATALOG_SEARCH_LIMIT))
    const payload = await fetchJson(url, `search:${chainId}:${search}`, signal)
    if (!validCatalog(payload, chainId)) throw new Error('Token catalog returned invalid data')
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
    const listeners = loadMoreListeners.get(Number(chainId))
    if (!listeners) return
    for (const listener of listeners) listener()
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
    const storedBrowse = useMemo(() =>
        enabled && Number.isSafeInteger(numericChainId)
            ? readStoredCatalog('all', numericChainId)
            : null, [enabled, numericChainId])
    const [state, setState] = useState({
        featuredTokens: storedFeatured?.tokens ?? [],
        browseTokens: storedBrowse?.tokens ?? [],
        searchTokens: [],
        loading: enabled && !storedFeatured,
        loadingMore: false,
        searchLoading: false,
        error: null,
        pageError: null,
        schemaVersion: storedFeatured?.schemaVersion ?? storedBrowse?.schemaVersion ?? null,
        nextCursor: storedBrowse?.nextCursor ?? null,
        cacheResumeCursor: storedBrowse?.nextCursor ?? null,
        hasMore: storedBrowse?.hasMore !== false,
        totalCount: storedBrowse?.diagnostics?.totalForChain ?? null,
    })
    const stateRef = useRef(state)
    const activeChainRef = useRef(numericChainId)
    const lastLoadMoreAtRef = useRef(0)

    useEffect(() => {
        stateRef.current = state
    }, [state])

    const appendPage = useCallback((payload) => {
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
            writeStoredCatalog('all', numericChainId, {
                ...payload,
                tokens: browseTokens,
                nextCursor: cacheResumeCursor,
                hasMore: cacheResumeCursor !== null &&
                    Number(payload.diagnostics?.totalForChain ?? browseTokens.length) > TOKEN_CATALOG_BROWSER_CACHE_LIMIT,
            })
            return next
        })
    }, [numericChainId])

    const loadMore = useCallback(async () => {
        if (!enabled || !Number.isSafeInteger(numericChainId)) return
        const current = stateRef.current
        const now = Date.now()
        if (current.loadingMore || !current.hasMore || now - lastLoadMoreAtRef.current < LOAD_MORE_COOLDOWN_MS) {
            return
        }
        lastLoadMoreAtRef.current = now
        setState((value) => ({ ...value, loadingMore: true, pageError: null }))
        try {
            const payload = await fetchCatalogPage(apiBaseUrl, numericChainId, current.nextCursor)
            if (activeChainRef.current !== numericChainId) return
            appendPage(payload)
        } catch (error) {
            if (activeChainRef.current !== numericChainId) return
            setState((value) => ({
                ...value,
                loadingMore: false,
                pageError: error instanceof Error ? error.message : 'More tokens could not be loaded.',
            }))
        }
    }, [apiBaseUrl, appendPage, enabled, numericChainId])

    useEffect(() => addLoadMoreListener(numericChainId, loadMore), [loadMore, numericChainId])

    useEffect(() => {
        activeChainRef.current = numericChainId
        lastLoadMoreAtRef.current = 0
        if (!enabled || !Number.isSafeInteger(numericChainId)) {
            setState({
                featuredTokens: [], browseTokens: [], searchTokens: [], loading: false,
                loadingMore: false, searchLoading: false, error: null, pageError: null,
                schemaVersion: null, nextCursor: null, cacheResumeCursor: null,
                hasMore: false, totalCount: null,
            })
            return undefined
        }

        let cancelled = false
        const featured = readStoredCatalog('featured', numericChainId)
        const browse = readStoredCatalog('all', numericChainId)
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
            hasMore: browse?.hasMore !== false,
            totalCount: browse?.diagnostics?.totalForChain ?? null,
        })

        fetchFeaturedCatalog(apiBaseUrl, numericChainId)
            .then((payload) => {
                if (cancelled || activeChainRef.current !== numericChainId) return
                setState((current) => ({
                    ...current,
                    featuredTokens: payload.tokens,
                    loading: false,
                    error: null,
                    schemaVersion: payload.schemaVersion,
                }))
            })
            .catch(() => {
                if (cancelled || activeChainRef.current !== numericChainId) return
                setState((current) => ({
                    ...current,
                    loading: false,
                    error: current.featuredTokens.length ? null : 'Token catalog is temporarily unavailable.',
                }))
            })

        if (!browse?.tokens?.length) {
            setState((current) => ({ ...current, loadingMore: true }))
            fetchCatalogPage(apiBaseUrl, numericChainId, null)
                .then((payload) => {
                    if (cancelled || activeChainRef.current !== numericChainId) return
                    appendPage(payload)
                })
                .catch((error) => {
                    if (cancelled || activeChainRef.current !== numericChainId) return
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
    }, [apiBaseUrl, appendPage, enabled, numericChainId])

    const normalizedSearch = search.trim().toLowerCase()
    useEffect(() => {
        if (!enabled || !Number.isSafeInteger(numericChainId) || !normalizedSearch) {
            setState((current) => ({ ...current, searchTokens: [], searchLoading: false }))
            return undefined
        }
        const controller = new AbortController()
        const timeout = setTimeout(() => {
            setState((current) => ({ ...current, searchLoading: true }))
            fetchCatalogSearch(apiBaseUrl, numericChainId, normalizedSearch, controller.signal)
                .then((payload) => {
                    if (controller.signal.aborted || activeChainRef.current !== numericChainId) return
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
    }, [apiBaseUrl, enabled, normalizedSearch, numericChainId])

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
