import {
    useEffect,
    useRef,
    useState,
} from 'react'

import {
    fetchMarketTokens,
    normalizeMarketChainScope,
} from '../services/marketTokens.js'

const COLD_CATALOG_RETRY_DELAYS_MS = [1_500, 4_000, 8_000]
export const MARKET_CATALOG_REVALIDATE_MS = 60_000
export const MARKET_SEARCH_DEBOUNCE_MS = 120

function getCatalogNotice(result) {
    const hasRankedTokens = Array.isArray(result.tokens) && result.tokens.length > 0
    if (result.stale || result.hardStale) {
        return 'Showing previously loaded market data.'
    }
    if (hasRankedTokens && (result.partial || result.catalogUnavailable)) {
        return 'Some market data could not be refreshed.'
    }
    if (!hasRankedTokens && (result.partial || result.catalogUnavailable)) {
        return 'Popular tokens are temporarily unavailable.'
    }
    return null
}

export function isLatestMarketTokenRequest({
    sequence,
    currentSequence,
    signal,
}) {
    return !signal.aborted && sequence === currentSequence
}

/**
 * Loads a market-token catalog for one chain/all chains and optional search.
 * @param {{chainId: number|string, search?: string, enabled?: boolean}} config Catalog query.
 * @returns {object} Ranked/common tokens, loading/error/partial/stale metadata, and refetch.
 * @sideEffects Performs abortable backend HTTP and uses the market-token cache/timers.
 */
export function useMarketTokens({
    chainId = 56,
    search = '',
    enabled = true,
} = {}) {
    const normalizedSearch = search.trim().toLowerCase()
    let chainScope
    try {
        chainScope = normalizeMarketChainScope(chainId)
    } catch {
        chainScope = 'invalid'
    }
    const requestKey = `${chainScope}:${normalizedSearch}`
    const requestSequence = useRef(0)
    const revalidateRef = useRef(null)
    const lastCatalogRequestAtRef = useRef(0)

    const [state, setState] = useState({
        requestKey: null,
        tokens: [],
        commonTokens: [],
        fallbackTokens: [],
        loading: true,
        error: null,
        chainErrors: {},
        browserCache: null,
        partial: false,
        stale: false,
        hardStale: false,
        catalogUnavailable: false,
        notice: null,
        schemaVersion: null,
        count: 0,
        commonCount: 0,
    })

    useEffect(() => {
        if (!enabled) return undefined
        const controller = new AbortController()
        const sequence = ++requestSequence.current
        let retryTimeoutId = null

        const scheduleRetry = (attempt) => {
            if (chainScope === 'all' || normalizedSearch ||
                attempt >= COLD_CATALOG_RETRY_DELAYS_MS.length) {
                return
            }
            retryTimeoutId = window.setTimeout(
                () => void loadCatalog(attempt + 1),
                COLD_CATALOG_RETRY_DELAYS_MS[attempt],
            )
        }

        const loadCatalog = async (attempt = 0, forceRefresh = false) => {
            try {
                lastCatalogRequestAtRef.current = Date.now()
                const result = await fetchMarketTokens({
                    chainId: chainScope,
                    query: normalizedSearch,
                    signal: controller.signal,
                    forceRefresh: forceRefresh || attempt > 0,
                })

                if (!isLatestMarketTokenRequest({
                    sequence,
                    currentSequence: requestSequence.current,
                    signal: controller.signal,
                })) {
                    return
                }

                const tokens = Array.isArray(result.tokens) ? result.tokens : []
                const commonTokens = Array.isArray(result.commonTokens)
                    ? result.commonTokens
                    : []
                const fallbackTokens = Array.isArray(result.fallbackTokens)
                    ? result.fallbackTokens
                    : commonTokens
                setState((current) => {
                    const degradedEmpty = tokens.length === 0 &&
                        (result.partial === true || result.catalogUnavailable === true)
                    const retainCurrent = current.requestKey === requestKey &&
                        current.tokens.length > 0 && degradedEmpty
                    const visibleTokens = retainCurrent ? current.tokens : tokens
                    const visibleCommonTokens = retainCurrent
                        ? current.commonTokens
                        : commonTokens
                    const visibleFallbackTokens = retainCurrent
                        ? current.fallbackTokens
                        : fallbackTokens
                    const visibleResult = retainCurrent
                        ? { ...result, tokens: visibleTokens, stale: true }
                        : { ...result, tokens: visibleTokens }
                    return {
                        requestKey,
                        tokens: visibleTokens,
                        commonTokens: visibleCommonTokens,
                        fallbackTokens: visibleFallbackTokens,
                        loading: false,
                        error: null,
                        chainErrors: result.chainErrors ?? result.errors ?? {},
                        browserCache: result.browserCache,
                        partial: result.partial === true || retainCurrent,
                        stale: result.stale === true || retainCurrent,
                        hardStale: result.hardStale === true,
                        catalogUnavailable: result.catalogUnavailable === true,
                        notice: getCatalogNotice(visibleResult),
                        schemaVersion: result.schemaVersion ?? current.schemaVersion ?? null,
                        count: visibleTokens.length,
                        commonCount: visibleCommonTokens.length,
                        fallbackCount: visibleFallbackTokens.length,
                        query: normalizedSearch,
                    }
                })

                if (tokens.length === 0 &&
                    (result.partial === true || result.catalogUnavailable === true)) {
                    scheduleRetry(attempt)
                }
            } catch (error) {
                if (controller.signal.aborted || error?.name === 'AbortError') {
                    return
                }

                setState((current) => current.requestKey === requestKey &&
                    current.tokens.length > 0
                    ? {
                          ...current,
                          loading: false,
                          error: null,
                          partial: true,
                          stale: true,
                          catalogUnavailable: true,
                          notice: 'Showing previously loaded market data.',
                      }
                    : {
                          requestKey,
                          tokens: [],
                          commonTokens: [],
                          fallbackTokens: [],
                          loading: false,
                          error: null,
                          browserCache: null,
                          chainErrors: {},
                          partial: true,
                          stale: false,
                          hardStale: false,
                          catalogUnavailable: true,
                          notice: 'Popular tokens are temporarily unavailable.',
                          schemaVersion: null,
                          count: 0,
                          commonCount: 0,
                          fallbackCount: 0,
                          query: normalizedSearch,
                      })
                scheduleRetry(attempt)
            }
        }

        const timeoutId = window.setTimeout(
            () => void loadCatalog(),
            normalizedSearch ? MARKET_SEARCH_DEBOUNCE_MS : 0,
        )
        revalidateRef.current = () => loadCatalog(0, true)

        return () => {
            window.clearTimeout(timeoutId)
            if (retryTimeoutId !== null) window.clearTimeout(retryTimeoutId)
            controller.abort()
            revalidateRef.current = null
        }
    }, [chainScope, normalizedSearch, requestKey, enabled])

    useEffect(() => {
        if (!enabled || chainScope !== 'all' || normalizedSearch ||
            typeof document === 'undefined') return undefined
        const revalidateWhenDue = () => {
            if (document.visibilityState === 'hidden' ||
                Date.now() - lastCatalogRequestAtRef.current <
                    MARKET_CATALOG_REVALIDATE_MS) return
            void revalidateRef.current?.()
        }
        const intervalId = window.setInterval(
            revalidateWhenDue,
            MARKET_CATALOG_REVALIDATE_MS,
        )
        document.addEventListener('visibilitychange', revalidateWhenDue)
        return () => {
            window.clearInterval(intervalId)
            document.removeEventListener('visibilitychange', revalidateWhenDue)
        }
    }, [chainScope, normalizedSearch, enabled])

    if (!enabled) {
        return {
            tokens: [], commonTokens: [], fallbackTokens: [], loading: false, error: null, chainErrors: {},
            browserCache: null, partial: false, stale: false, hardStale: false,
            catalogUnavailable: false, notice: null, schemaVersion: null,
            count: 0, commonCount: 0, fallbackCount: 0, query: normalizedSearch,
        }
    }

    if (state.requestKey !== requestKey) {
        return {
            tokens: [],
            commonTokens: [],
            fallbackTokens: [],
            loading: true,
            error: null,
            chainErrors: {},
            browserCache: null,
            partial: false,
            stale: false,
            hardStale: false,
            catalogUnavailable: false,
            notice: null,
            schemaVersion: null,
            count: 0,
            commonCount: 0,
            fallbackCount: 0,
            query: normalizedSearch,
        }
    }

    return {
        ...state,
        query: normalizedSearch,
    }
}
