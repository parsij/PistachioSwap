import { normalizeAddress } from '../../lib/address.js'
import {
    type DexPair,
    dexScreenerRequest,
} from './dexscreener-client.js'
import { tokenDiscoveryContext } from '../../token-discovery/context.js'

export type TokenMarket = {
    address: string
    name: string
    symbol: string
    priceUSD: string | null
    volume24hUsd: number
    liquidityUsd: number
    pairCount: number
    pairUrl: string | null
    oldestPairCreatedAt: string | null
}

export type TokenMarketBatchResult = {
    markets: Map<string, TokenMarket>
    partial: boolean
    successfulBatches: number
    failedBatches: number
}

function splitIntoChunks<T>(values: T[], size: number) {
    const output: T[][] = []
    for (let index = 0; index < values.length; index += size) {
        output.push(values.slice(index, index + size))
    }
    return output
}

function pairId(pair: DexPair) {
    return `${pair.chainId}:${pair.pairAddress}`
}

/**
 * Each distinct pair contributes half its 24-hour volume to each token side.
 * This is the catalog's per-token volume policy: a pair discovered for both
 * sides never doubles its total activity. Pool liquidity is retained in full
 * for each side because it describes that token's available market depth.
 */
export function aggregateTokenMarkets(
    pairs: DexPair[],
): Map<string, TokenMarket> {
    const markets = new Map<
        string,
        TokenMarket & {
            seenPairs: Set<string>
            marketUrlLiquidityUsd: number
            priceLiquidityUsd: number
        }
    >()

    for (const pair of pairs) {
        const identifier = pairId(pair)
        const sides = [pair.baseToken, pair.quoteToken]
        const uniqueSides = new Map(
            sides.map((token) => [token.address.toLowerCase(), token]),
        )
        const volumeShare = 1 / uniqueSides.size

        for (const token of uniqueSides.values()) {
            const address = normalizeAddress(token.address)
            if (!address) continue

            const existing = markets.get(address) ?? {
                address,
                name: token.name,
                symbol: token.symbol,
                priceUSD: null,
                volume24hUsd: 0,
                liquidityUsd: 0,
                pairCount: 0,
                pairUrl: null,
                oldestPairCreatedAt: null,
                seenPairs: new Set<string>(),
                marketUrlLiquidityUsd: -1,
                priceLiquidityUsd: -1,
            }

            if (existing.seenPairs.has(identifier)) continue
            existing.seenPairs.add(identifier)
            existing.volume24hUsd += pair.volume24hUsd * volumeShare
            existing.liquidityUsd += pair.liquidityUsd
            existing.pairCount += 1

            if (
                pair.url &&
                pair.liquidityUsd > existing.marketUrlLiquidityUsd
            ) {
                existing.pairUrl = pair.url
                existing.marketUrlLiquidityUsd = pair.liquidityUsd
            }

            if (
                typeof pair.pairCreatedAt === 'number' &&
                Number.isFinite(pair.pairCreatedAt)
            ) {
                const createdAt = new Date(pair.pairCreatedAt).toISOString()
                if (
                    !existing.oldestPairCreatedAt ||
                    createdAt < existing.oldestPairCreatedAt
                ) {
                    existing.oldestPairCreatedAt = createdAt
                }
            }

            if (
                address === normalizeAddress(pair.baseToken.address) &&
                pair.priceUsd &&
                pair.liquidityUsd > existing.priceLiquidityUsd
            ) {
                existing.priceUSD = pair.priceUsd
                existing.priceLiquidityUsd = pair.liquidityUsd
            }

            markets.set(address, existing)
        }
    }

    return new Map(
        [...markets].map(([address, market]) => {
            const {
                seenPairs: _seenPairs,
                marketUrlLiquidityUsd: _marketUrlLiquidityUsd,
                priceLiquidityUsd: _priceLiquidityUsd,
                ...normalized
            } = market
            return [address, normalized]
        }),
    )
}

export async function fetchTokenMarkets(
    addresses: string[],
    signal?: AbortSignal,
    chainId = 56,
): Promise<TokenMarketBatchResult> {
    const context = tokenDiscoveryContext(chainId)
    if (!context.chain.capabilities.dexScreener) {
        return { markets: new Map(), partial: true, successfulBatches: 0, failedBatches: 0 }
    }
    const providerChain = context.chain.providers.dexScreenerChain
    const unique = [
        ...new Set(
            addresses
                .map(normalizeAddress)
                .filter((value): value is string => value !== null),
        ),
    ]
    const pairs: DexPair[] = []
    let successfulBatches = 0
    let failedBatches = 0
    let lastError: unknown

    for (const batch of splitIntoChunks(unique, 30)) {
        const path =
            `/tokens/v1/${providerChain}/` +
            batch.map(encodeURIComponent).join(',')

        try {
            pairs.push(...(await dexScreenerRequest(path, signal)))
            successfulBatches += 1
        } catch (error) {
            // Preserve successful address batches. Tokens in this failed
            // batch simply have no confirmed DexScreener market this refresh.
            failedBatches += 1
            lastError = error
        }
    }

    if (
        unique.length > 0 &&
        successfulBatches === 0 &&
        failedBatches > 0 &&
        lastError
    ) {
        throw lastError
    }

    return {
        markets: aggregateTokenMarkets(
            pairs.filter(
                (pair) => pair.chainId === providerChain,
            ),
        ),
        partial: failedBatches > 0,
        successfulBatches,
        failedBatches,
    }
}
