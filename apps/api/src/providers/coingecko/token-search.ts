import { getApiConfig } from '../../config.js'
import { isRecord } from '../../lib/http.js'
import { coinGeckoRequest } from './coingecko-client.js'
import {
    type CoinGeckoToken,
    normalizeCoinGeckoToken,
} from './token-data.js'

type SearchCacheEntry = {
    expiresAt: number
    tokens: CoinGeckoToken[]
}

const searchCache = new Map<string, SearchCacheEntry>()

function relationshipId(value: unknown) {
    return isRecord(value) &&
        isRecord(value.data) &&
        typeof value.data.id === 'string'
        ? value.data.id.toLowerCase()
        : null
}

export function extractCoinGeckoSearchTokens(
    payload: unknown,
    network: string,
    limit = 20,
) {
    if (!isRecord(payload) || !Array.isArray(payload.data)) return []

    const included = new Map<string, CoinGeckoToken>()
    if (Array.isArray(payload.included)) {
        for (const value of payload.included) {
            const token = normalizeCoinGeckoToken(value, network)
            if (token && isRecord(value) && typeof value.id === 'string') {
                included.set(value.id.toLowerCase(), token)
            }
        }
    }

    const tokens = new Map<string, CoinGeckoToken>()
    for (const pool of payload.data) {
        if (!isRecord(pool) || !isRecord(pool.relationships)) continue

        const ids = [
            relationshipId(pool.relationships.base_token),
            relationshipId(pool.relationships.quote_token),
        ]

        for (const id of ids) {
            if (!id || !id.startsWith(`${network.toLowerCase()}_`)) continue
            const token = included.get(id)
            if (!token || tokens.has(token.address)) continue
            tokens.set(token.address, token)
            if (tokens.size >= limit) return [...tokens.values()]
        }
    }

    return [...tokens.values()]
}

export async function searchCoinGeckoTokens(
    query: string,
    signal?: AbortSignal,
) {
    const normalizedQuery = query.trim().toLowerCase()
    const config = getApiConfig().coinGecko
    const cacheKey = `${config.network}:${normalizedQuery}`
    const cached = searchCache.get(cacheKey)

    if (cached && cached.expiresAt > Date.now()) return cached.tokens

    const search = new URLSearchParams({
        query: normalizedQuery,
        network: config.network,
        include: 'base_token,quote_token',
    })
    const payload = await coinGeckoRequest(
        `/onchain/search/pools?${search.toString()}`,
        { signal },
    )
    const tokens = extractCoinGeckoSearchTokens(
        payload,
        config.network,
        20,
    )

    searchCache.set(cacheKey, {
        tokens,
        expiresAt: Date.now() + config.searchTtlMs,
    })
    return tokens
}
