import type { FastifyPluginAsync } from 'fastify'

import { isRecord, validateRemoteImageUrl } from '../lib/http.js'
import { geckoTerminalRequest } from '../providers/geckoterminal/geckoterminal-client.js'
import {
    ACTIVE_TOKEN_DISCOVERY_CHAINS,
    type TokenDiscoveryChain,
} from '../token-discovery/registry.js'

const CACHE_TTL_MS = 60_000
const MAX_POOLS = 20
const DEFAULT_POOLS = 15
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/

export type MarketPoolToken = {
    chainId: number
    address: string
    name: string
    symbol: string
    decimals: number | null
    logoURI: string | null
}

export type MarketPool = {
    id: string
    chainId: number
    networkId: string
    address: string
    name: string
    protocol: string | null
    feePercent: string | null
    volume24hUsd: number
    liquidityUsd: number | null
    baseToken: MarketPoolToken | null
    quoteToken: MarketPoolToken | null
}

type PoolQuery = {
    chainId?: string
    q?: string
    limit?: number
}

type PoolRequest = typeof geckoTerminalRequest

type MarketPoolService = {
    getPools(input: {
        chainId: number | 'all'
        query?: string
        limit?: number
        signal?: AbortSignal
    }): Promise<{
        pools: MarketPool[]
        partial: boolean
        generatedAt: number
    }>
}

type CacheEntry = {
    expiresAt: number
    value: {
        pools: MarketPool[]
        partial: boolean
        generatedAt: number
    }
}

function safeText(value: unknown, maximum = 160) {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized && normalized.length <= maximum ? normalized : null
}

function safeNumber(value: unknown) {
    const numeric = Number(value)
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

function safeAddress(value: unknown) {
    const address = safeText(value, 66)?.toLowerCase()
    return address && EVM_ADDRESS.test(address) ? address : null
}

function relationId(value: unknown) {
    if (!isRecord(value) || !isRecord(value.data)) return null
    return safeText(value.data.id, 220)
}

function includedById(payload: Record<string, unknown>) {
    const items = new Map<string, Record<string, unknown>>()
    if (!Array.isArray(payload.included)) return items

    for (const item of payload.included) {
        if (!isRecord(item)) continue
        const id = safeText(item.id, 220)
        if (!id) continue
        items.set(id, item)
    }
    return items
}

function chainFromPoolId(id: string): TokenDiscoveryChain | null {
    const normalized = id.toLowerCase()
    let best: TokenDiscoveryChain | null = null

    for (const chain of ACTIVE_TOKEN_DISCOVERY_CHAINS) {
        const network = chain.providers.geckoTerminalNetwork.toLowerCase()
        if (!normalized.startsWith(network + '_')) continue
        if (
            !best ||
            network.length > best.providers.geckoTerminalNetwork.length
        ) {
            best = chain
        }
    }

    return best
}

function tokenFromRelationship({
    relationship,
    included,
    chain,
}: {
    relationship: unknown
    included: Map<string, Record<string, unknown>>
    chain: TokenDiscoveryChain
}): MarketPoolToken | null {
    const id = relationId(relationship)
    if (!id) return null
    const item = included.get(id)
    const attributes = item && isRecord(item.attributes)
        ? item.attributes
        : {}
    const address = safeAddress(attributes.address) ??
        safeAddress(id.match(/0x[a-fA-F0-9]{40}$/)?.[0])
    if (!address) return null

    const name = safeText(attributes.name, 120) ?? 'Unknown token'
    const symbol = safeText(attributes.symbol, 32) ?? 'TOKEN'
    const decimalsValue = Number(attributes.decimals)
    const decimals = Number.isInteger(decimalsValue) &&
        decimalsValue >= 0 &&
        decimalsValue <= 255
        ? decimalsValue
        : null

    return {
        chainId: chain.chainId,
        address,
        name,
        symbol,
        decimals,
        logoURI: validateRemoteImageUrl(attributes.image_url),
    }
}

function dexName(
    relationship: unknown,
    included: Map<string, Record<string, unknown>>,
) {
    const id = relationId(relationship)
    if (!id) return null
    const item = included.get(id)
    const attributes = item && isRecord(item.attributes)
        ? item.attributes
        : null
    return safeText(attributes?.name, 80) ??
        safeText(attributes?.identifier, 80) ??
        id.split('_').slice(1).join('_') ||
        null
}

function protocolLabel(value: string | null) {
    const normalized = String(value ?? '').toLowerCase()
    const match = normalized.match(/(?:^|[^a-z0-9])v([234])(?:$|[^a-z0-9])/)
    return match ? 'v' + match[1] : null
}

function feeFromName(value: string | null) {
    const match = String(value ?? '').match(/(\d+(?:\.\d+)?)%\s*$/)
    return match?.[1] ?? null
}

export function extractMarketPools(payload: unknown): MarketPool[] {
    if (!isRecord(payload) || !Array.isArray(payload.data)) return []
    const included = includedById(payload)
    const pools: MarketPool[] = []

    for (const candidate of payload.data) {
        if (!isRecord(candidate)) continue
        const id = safeText(candidate.id, 220)
        const attributes = isRecord(candidate.attributes)
            ? candidate.attributes
            : null
        const relationships = isRecord(candidate.relationships)
            ? candidate.relationships
            : null
        if (!id || !attributes || !relationships) continue

        const chain = chainFromPoolId(id)
        if (!chain) continue
        const address = safeAddress(attributes.address) ??
            safeAddress(id.match(/0x[a-fA-F0-9]{40}$/)?.[0])
        if (!address) continue

        const baseToken = tokenFromRelationship({
            relationship: relationships.base_token,
            included,
            chain,
        })
        const quoteToken = tokenFromRelationship({
            relationship: relationships.quote_token,
            included,
            chain,
        })
        const rawName = safeText(attributes.name, 160)
        const pairName = baseToken && quoteToken
            ? baseToken.symbol + '/' + quoteToken.symbol
            : rawName ?? 'Pool'
        const volume = isRecord(attributes.volume_usd)
            ? safeNumber(attributes.volume_usd.h24)
            : null
        if (volume === null) continue
        const dex = dexName(relationships.dex, included)

        pools.push({
            id,
            chainId: chain.chainId,
            networkId: chain.providers.geckoTerminalNetwork,
            address,
            name: pairName,
            protocol: protocolLabel(dex) ?? protocolLabel(rawName),
            feePercent: feeFromName(rawName),
            volume24hUsd: volume,
            liquidityUsd: safeNumber(attributes.reserve_in_usd),
            baseToken,
            quoteToken,
        })
    }

    return pools.sort((left, right) =>
        right.volume24hUsd - left.volume24hUsd ||
        right.liquidityUsd! - left.liquidityUsd!)
}

function normalizeScope(value: number | 'all') {
    if (value === 'all') return 'all'
    const chain = ACTIVE_TOKEN_DISCOVERY_CHAINS.find(
        (candidate) => candidate.chainId === value,
    )
    return chain ?? null
}

function poolPath({
    scope,
    query,
}: {
    scope: TokenDiscoveryChain | 'all'
    query: string
}) {
    const include = 'base_token,quote_token,dex'
    if (query) {
        const params = new URLSearchParams({
            query,
            include,
        })
        return '/search/pools?' + params.toString()
    }

    if (scope === 'all') {
        return '/networks/trending_pools?include=' +
            encodeURIComponent(include)
    }

    const params = new URLSearchParams({
        include,
        sort: 'h24_volume_usd_desc',
        page: '1',
    })
    return '/networks/' +
        encodeURIComponent(scope.providers.geckoTerminalNetwork) +
        '/pools?' +
        params.toString()
}

export function createMarketPoolService({
    request = geckoTerminalRequest,
    now = () => Date.now(),
}: {
    request?: PoolRequest
    now?: () => number
} = {}): MarketPoolService {
    const cache = new Map<string, CacheEntry>()
    const inFlight = new Map<string, Promise<CacheEntry['value']>>()

    async function getPools({
        chainId,
        query = '',
        limit = DEFAULT_POOLS,
        signal,
    }: {
        chainId: number | 'all'
        query?: string
        limit?: number
        signal?: AbortSignal
    }) {
        const scope = normalizeScope(chainId)
        if (!scope) {
            return {
                pools: [],
                partial: true,
                generatedAt: now(),
            }
        }
        const normalizedQuery = query.trim().slice(0, 120)
        const normalizedLimit = Math.min(
            MAX_POOLS,
            Math.max(1, Math.trunc(limit || DEFAULT_POOLS)),
        )
        const key = JSON.stringify({
            chainId: scope === 'all' ? 'all' : scope.chainId,
            query: normalizedQuery.toLowerCase(),
            limit: normalizedLimit,
        })
        const cached = cache.get(key)
        const timestamp = now()
        if (cached && cached.expiresAt > timestamp) {
            return cached.value
        }

        const existing = inFlight.get(key)
        if (existing) return existing

        const pending = (async () => {
            try {
                const payload = await request(
                    poolPath({ scope, query: normalizedQuery }),
                    signal,
                    1,
                )
                const pools = extractMarketPools(payload)
                    .filter((pool) =>
                        scope === 'all' ||
                        pool.chainId === scope.chainId)
                    .slice(0, normalizedLimit)
                const value = {
                    pools,
                    partial: false,
                    generatedAt: now(),
                }
                cache.set(key, {
                    value,
                    expiresAt: now() + CACHE_TTL_MS,
                })
                return value
            } catch {
                const value = {
                    pools: [],
                    partial: true,
                    generatedAt: now(),
                }
                cache.set(key, {
                    value,
                    expiresAt: now() + 15_000,
                })
                return value
            } finally {
                inFlight.delete(key)
            }
        })()
        inFlight.set(key, pending)
        return pending
    }

    return { getPools }
}

export function createMarketPoolRoutes(
    service: MarketPoolService = createMarketPoolService(),
): FastifyPluginAsync {
    return async function marketPoolRoutes(app) {
        app.get<{ Querystring: PoolQuery }>(
            '/v1/market-pools',
            {
                schema: {
                    querystring: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            chainId: {
                                type: 'string',
                                maxLength: 32,
                            },
                            q: {
                                type: 'string',
                                maxLength: 120,
                            },
                            limit: {
                                type: 'integer',
                                minimum: 1,
                                maximum: MAX_POOLS,
                            },
                        },
                    },
                },
            },
            async (request, reply) => {
                const rawScope = String(
                    request.query.chainId ?? 'all',
                ).trim().toLowerCase()
                const parsedChain = rawScope === 'all'
                    ? 'all'
                    : Number(rawScope)
                const validChain = parsedChain === 'all' ||
                    (
                        Number.isSafeInteger(parsedChain) &&
                        ACTIVE_TOKEN_DISCOVERY_CHAINS.some(
                            (chain) => chain.chainId === parsedChain,
                        )
                    )
                if (!validChain) {
                    return reply.code(400).send({
                        error: {
                            code: 'INVALID_CHAIN',
                            message: 'A supported pool network is required.',
                        },
                    })
                }

                const result = await service.getPools({
                    chainId: parsedChain as number | 'all',
                    query: request.query.q ?? '',
                    limit: request.query.limit ?? DEFAULT_POOLS,
                    signal: request.raw.signal,
                })
                return {
                    schemaVersion: 1,
                    chainId: parsedChain,
                    query: String(request.query.q ?? '').trim(),
                    generatedAt: result.generatedAt,
                    partial: result.partial,
                    count: result.pools.length,
                    pools: result.pools,
                }
            },
        )
    }
}

export const marketPoolRoutes = createMarketPoolRoutes()
