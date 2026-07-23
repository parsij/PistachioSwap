import { useEffect, useMemo, useState } from 'react'

const CACHE_TTL_MS = 2 * 60 * 1000
let cache = null
let pending = null

function matches(token, query) {
    if (!query) return true
    return [token?.name, token?.symbol, token?.address]
        .some((value) => String(value ?? '').toLowerCase().includes(query))
}

async function fetchCatalog(apiBaseUrl, signal) {
    if (cache && cache.expiresAt > Date.now()) return cache.payload
    if (!pending) {
        const url = new URL(
            `${apiBaseUrl.replace(/\/+$/, '')}/v1/uniswap-volume-tokens`,
        )
        url.searchParams.set('chainId', 'all')
        url.searchParams.set('limit', '2400')
        pending = fetch(url, {
            headers: { accept: 'application/json' },
            cache: 'default',
            signal,
        }).then(async (response) => {
            if (!response.ok) {
                throw new Error(`Uniswap volume catalog failed with ${response.status}`)
            }
            const payload = await response.json()
            if (payload?.schemaVersion !== 7 || !Array.isArray(payload.tokens)) {
                throw new Error('Uniswap volume catalog returned invalid data')
            }
            cache = {
                payload,
                expiresAt: Date.now() + CACHE_TTL_MS,
            }
            return payload
        }).finally(() => {
            pending = null
        })
    }
    return pending
}

export function useUniswapVolumeTokens({
    chainId = 'all',
    search = '',
    enabled = true,
    apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001',
} = {}) {
    const [state, setState] = useState({
        tokens: [],
        loading: enabled,
        error: null,
        partial: false,
        stale: false,
        schemaVersion: null,
    })

    useEffect(() => {
        if (!enabled) {
            setState({
                tokens: [], loading: false, error: null, partial: false,
                stale: false, schemaVersion: null,
            })
            return undefined
        }
        const controller = new AbortController()
        setState((current) => ({ ...current, loading: true, error: null }))
        fetchCatalog(apiBaseUrl, controller.signal).then((payload) => {
            if (controller.signal.aborted) return
            setState({
                tokens: payload.tokens,
                loading: false,
                error: null,
                partial: payload.partial === true,
                stale: payload.stale === true,
                schemaVersion: payload.schemaVersion,
            })
        }).catch((error) => {
            if (controller.signal.aborted || error?.name === 'AbortError') return
            setState((current) => ({
                ...current,
                loading: false,
                error: 'Uniswap volume tokens are temporarily unavailable.',
            }))
        })
        return () => controller.abort()
    }, [apiBaseUrl, enabled])

    const normalizedSearch = search.trim().toLowerCase()
    const tokens = useMemo(() => state.tokens.filter((token) =>
        (String(chainId).toLowerCase() === 'all' ||
            Number(token.chainId) === Number(chainId)) &&
        matches(token, normalizedSearch)), [chainId, normalizedSearch, state.tokens])

    return {
        ...state,
        tokens,
        count: tokens.length,
    }
}

export function clearUniswapVolumeTokenCache() {
    cache = null
    pending = null
}
