import { apiBaseUrl as defaultApiBaseUrl } from '../../../lib/apiBaseUrl.js'

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/

function normalizeScope(value) {
    if (String(value).trim().toLowerCase() === 'all') return 'all'
    const chainId = Number(value)
    return Number.isSafeInteger(chainId) && chainId > 0
        ? chainId
        : 'all'
}

function validPoolToken(token, chainId) {
    return token === null || (
        token &&
        Number(token.chainId) === Number(chainId) &&
        EVM_ADDRESS.test(String(token.address ?? '')) &&
        typeof token.name === 'string' &&
        typeof token.symbol === 'string'
    )
}

function validPool(pool) {
    return pool &&
        typeof pool.id === 'string' &&
        Number.isSafeInteger(Number(pool.chainId)) &&
        EVM_ADDRESS.test(String(pool.address ?? '')) &&
        typeof pool.name === 'string' &&
        Number.isFinite(Number(pool.volume24hUsd)) &&
        validPoolToken(pool.baseToken, pool.chainId) &&
        validPoolToken(pool.quoteToken, pool.chainId)
}

export async function fetchMarketPools({
    chainId = 'all',
    query = '',
    limit = 15,
    signal,
    apiBaseUrl = defaultApiBaseUrl,
} = {}) {
    const baseUrl = apiBaseUrl.replace(/\/+$/, '')
    const url = new URL(
        baseUrl + '/v1/market-pools',
        globalThis.location?.origin,
    )
    url.searchParams.set('chainId', String(normalizeScope(chainId)))
    url.searchParams.set(
        'limit',
        String(Math.min(20, Math.max(1, Math.trunc(Number(limit) || 15)))),
    )
    const normalizedQuery = String(query ?? '').trim()
    if (normalizedQuery) url.searchParams.set('q', normalizedQuery)

    const response = await fetch(url, {
        method: 'GET',
        cache: 'default',
        headers: {
            accept: 'application/json',
        },
        signal,
    })
    if (!response.ok) {
        throw new Error('Pool request failed with ' + response.status)
    }

    const payload = await response.json()
    if (
        payload?.schemaVersion !== 1 ||
        !Array.isArray(payload?.pools) ||
        payload.pools.some((pool) => !validPool(pool))
    ) {
        throw new Error('Backend returned an invalid pool list')
    }

    return {
        pools: payload.pools,
        partial: payload.partial === true,
        generatedAt: Number(payload.generatedAt) || null,
    }
}
