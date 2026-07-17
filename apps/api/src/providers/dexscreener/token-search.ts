import { normalizeAddress } from '../../lib/address.js'
import { tokenDiscoveryContext } from '../../token-discovery/context.js'
import {
    getTokenDiscoveryChainByDexScreenerId,
} from '../../token-discovery/registry.js'
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
    chainId = 56,
) {
    const context = tokenDiscoveryContext(chainId)
    if (!context.chain.capabilities.dexScreener) return []
    const providerChain = context.chain.providers.dexScreenerChain
    let pairs: DexPair[]
    const address = normalizeAddress(query)

    if (address) {
        pairs = await dexScreenerRequest(
            `/tokens/v1/${providerChain}/${address}`,
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
            (pair) => pair.chainId === providerChain,
        ),
    )
    return rankSearchResults([...markets.values()], query)
}

export async function searchTokensAcrossChains(
    query: string,
    signal?: AbortSignal,
) {
    const pairs = await dexScreenerRequest(
        `/latest/dex/search?q=${encodeURIComponent(query)}`,
        signal,
    )
    const grouped = new Map<string, DexPair[]>()
    for (const pair of pairs) {
        if (!getTokenDiscoveryChainByDexScreenerId(pair.chainId)) continue
        const values = grouped.get(pair.chainId) ?? []
        values.push(pair)
        grouped.set(pair.chainId, values)
    }
    return [...grouped].flatMap(([providerChainId, chainPairs]) => {
        const chain = getTokenDiscoveryChainByDexScreenerId(providerChainId)
        if (!chain) return []
        return rankSearchResults(
            [...aggregateTokenMarkets(chainPairs).values()],
            query,
        ).slice(0, 8).map((market) => ({
            chainId: chain.chainId,
            market,
        }))
    })
}
