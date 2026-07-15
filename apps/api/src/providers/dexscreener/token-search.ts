import { getApiConfig } from '../../config.js'
import { normalizeAddress } from '../../lib/address.js'
import {
    type DexPair,
    dexScreenerRequest,
} from './dexscreener-client.js'
import {
    type TokenMarket,
    aggregateTokenMarkets,
} from './token-markets.js'

type SearchableToken = Pick<
    TokenMarket,
    'address' | 'name' | 'symbol' | 'volume24hUsd' | 'liquidityUsd'
>

function relevance(token: SearchableToken, query: string) {
    const addressQuery = normalizeAddress(query)
    const symbol = token.symbol.toLowerCase()
    const name = token.name.toLowerCase()

    if (addressQuery && token.address === addressQuery) return 0
    if (symbol === query) return 1
    if (name === query) return 2
    if (symbol.startsWith(query)) return 3
    if (name.startsWith(query)) return 4
    if (symbol.includes(query)) return 5
    if (name.includes(query)) return 6
    return 7
}

export function rankSearchResults<T extends SearchableToken>(
    markets: T[],
    query: string,
) {
    const normalizedQuery = query.trim().toLowerCase()

    return [...markets].sort((left, right) => {
            const relevanceDifference =
                relevance(left, normalizedQuery) -
                relevance(right, normalizedQuery)
            if (relevanceDifference !== 0) return relevanceDifference

            const volumeDifference =
                right.volume24hUsd - left.volume24hUsd
            if (volumeDifference !== 0) return volumeDifference

            const liquidityDifference =
                right.liquidityUsd - left.liquidityUsd
            if (liquidityDifference !== 0) return liquidityDifference

            return left.symbol.localeCompare(right.symbol)
        })
}

export async function searchTokens(
    query: string,
    signal?: AbortSignal,
) {
    const config = getApiConfig()
    let pairs: DexPair[]
    const address = normalizeAddress(query)

    if (address) {
        pairs = await dexScreenerRequest(
            `/tokens/v1/${config.dexScreener.chainId}/${address}`,
            signal,
        )
    } else {
        pairs = await dexScreenerRequest(
            `/latest/dex/search?q=${encodeURIComponent(query)}`,
            signal,
        )
    }

    const markets = aggregateTokenMarkets(
        pairs.filter(
            (pair) => pair.chainId === config.dexScreener.chainId,
        ),
    )
    return rankSearchResults([...markets.values()], query)
}
