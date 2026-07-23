import { createHash } from 'node:crypto'

import type { FastifyPluginAsync } from 'fastify'

import {
    createTokenId,
    normalizeAddress,
} from '../lib/address.js'
import { fetchJson, isRecord } from '../lib/http.js'
import {
    ACTIVE_TOKEN_DISCOVERY_CHAINS,
    getTokenDiscoveryChain,
} from '../token-discovery/registry.js'

type ListedToken = {
    chainId: number
    address: string
    name: string
    symbol: string
    decimals: number
    logoURI: string
}

type VolumeToken = ListedToken & {
    priceUSD: string | null
    volume24hUsd: number
    liquidityUsd: number
}

type CacheEntry = {
    expiresAt: number
    generatedAt: number
    tokens: VolumeToken[]
    failedEndpoints: string[]
}

type Query = {
    chainId?: string
    limit?: string
    q?: string
}

const TOKEN_LIST_TTL_MS = 6 * 60 * 60 * 1000
const VOLUME_CACHE_TTL_MS = 2 * 60 * 1000
const MAX_ROWS_PER_ENDPOINT = 1_000
const MAX_QUERY_LENGTH = 80

let tokenListCache: {
    expiresAt: number
    values: Map<string, ListedToken>
} | null = null
const volumeCache = new Map<string, CacheEntry>()
const pending = new Map<string, Promise<CacheEntry>>()

function endpointMap() {
    const raw = process.env.UNISWAP_SUBGRAPH_URLS_JSON?.trim()
    if (!raw) return new Map<number, string[]>()
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
        throw new Error('UNISWAP_SUBGRAPH_URLS_JSON must be a JSON object.')
    }
    const result = new Map<number, string[]>()
    for (const [chainIdText, configured] of Object.entries(parsed)) {
        const chainId = Number(chainIdText)
        if (!Number.isSafeInteger(chainId) || !getTokenDiscoveryChain(chainId)?.active) {
            continue
        }
        const candidates = Array.isArray(configured) ? configured : [configured]
        const urls = candidates.flatMap((candidate) => {
            if (typeof candidate !== 'string' || !candidate.trim()) return []
            const url = new URL(candidate.trim())
            if (url.protocol !== 'https:' || url.username || url.password) return []
            return [url.toString()]
        })
        if (urls.length > 0) result.set(chainId, [...new Set(urls)])
    }
    return result
}

function validDecimals(value: unknown) {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255
        ? parsed
        : null
}

function decimalText(value: unknown) {
    const text = String(value ?? '').trim()
    return /^\d+(?:\.\d+)?$/.test(text) ? text : null
}

function decimalNumber(value: unknown) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function cleanText(value: unknown, maximum: number) {
    if (typeof value !== 'string') return null
    const text = value.trim()
    return text && text.length <= maximum ? text : null
}

function tokenKey(chainId: number, address: string) {
    return `${chainId}:${address}`
}

async function loadTokenList(signal?: AbortSignal) {
    if (tokenListCache && tokenListCache.expiresAt > Date.now()) {
        return tokenListCache.values
    }
    const configured = process.env.UNISWAP_TOKEN_LIST_URL?.trim() ||
        'https://tokens.uniswap.org'
    const url = new URL(configured)
    if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('UNISWAP_TOKEN_LIST_URL must be an HTTPS URL.')
    }
    const payload = await fetchJson(url, {
        signal,
        timeoutMs: 10_000,
        retries: 1,
        dedupeKey: `uniswap-token-list:${url}`,
    })
    const source = isRecord(payload) && Array.isArray(payload.tokens)
        ? payload.tokens
        : []
    const values = new Map<string, ListedToken>()
    for (const candidate of source) {
        if (!isRecord(candidate)) continue
        const chainId = Number(candidate.chainId)
        const address = normalizeAddress(candidate.address)
        const decimals = validDecimals(candidate.decimals)
        const name = cleanText(candidate.name, 120)
        const symbol = cleanText(candidate.symbol, 32)
        const logoURI = cleanText(candidate.logoURI, 2_048)
        if (
            !Number.isSafeInteger(chainId) ||
            !address ||
            decimals === null ||
            !name ||
            !symbol ||
            !logoURI
        ) continue
        values.set(tokenKey(chainId, address), {
            chainId,
            address,
            name,
            symbol,
            decimals,
            logoURI,
        })
    }
    tokenListCache = {
        values,
        expiresAt: Date.now() + TOKEN_LIST_TTL_MS,
    }
    return values
}

const TOKEN_HOUR_QUERY = `
query PistachioTopTokens($since: Int!, $first: Int!) {
  tokenHourDatas(
    first: $first
    where: { periodStartUnix_gte: $since }
    orderBy: volumeUSD
    orderDirection: desc
  ) {
    periodStartUnix
    volumeUSD
    close
    token {
      id
      totalValueLockedUSD
    }
  }
}`

async function fetchEndpointVolume({
    chainId,
    endpoint,
    listed,
    since,
    signal,
}: {
    chainId: number
    endpoint: string
    listed: Map<string, ListedToken>
    since: number
    signal?: AbortSignal
}) {
    const payload = await fetchJson(new URL(endpoint), {
        method: 'POST',
        body: {
            query: TOKEN_HOUR_QUERY,
            variables: {
                since,
                first: MAX_ROWS_PER_ENDPOINT,
            },
        },
        signal,
        timeoutMs: Number(process.env.UNISWAP_SUBGRAPH_TIMEOUT_MS ?? 12_000),
        retries: 1,
        dedupeKey: `uniswap-volume:${chainId}:${endpoint}:${Math.floor(since / 300)}`,
    })
    if (
        !isRecord(payload) ||
        (Array.isArray(payload.errors) && payload.errors.length > 0) ||
        !isRecord(payload.data) ||
        !Array.isArray(payload.data.tokenHourDatas)
    ) {
        throw new Error('Uniswap subgraph returned an invalid tokenHourDatas response.')
    }

    const values = new Map<string, {
        volume24hUsd: number
        liquidityUsd: number
        priceUSD: string | null
        latestHour: number
    }>()
    for (const row of payload.data.tokenHourDatas) {
        if (!isRecord(row) || !isRecord(row.token)) continue
        const address = normalizeAddress(row.token.id)
        if (!address || !listed.has(tokenKey(chainId, address))) continue
        const volume = decimalNumber(row.volumeUSD)
        if (volume === null || volume <= 0) continue
        const hour = Number(row.periodStartUnix)
        const liquidity = decimalNumber(row.token.totalValueLockedUSD) ?? 0
        const price = decimalText(row.close)
        const current = values.get(address) ?? {
            volume24hUsd: 0,
            liquidityUsd: 0,
            priceUSD: null,
            latestHour: 0,
        }
        current.volume24hUsd += volume
        current.liquidityUsd = Math.max(current.liquidityUsd, liquidity)
        if (Number.isFinite(hour) && hour >= current.latestHour) {
            current.latestHour = hour
            current.priceUSD = price ?? current.priceUSD
        }
        values.set(address, current)
    }
    return values
}

async function buildChainCatalog(
    chainId: number,
    signal?: AbortSignal,
): Promise<CacheEntry> {
    const endpoints = endpointMap().get(chainId) ?? []
    if (endpoints.length === 0) {
        return {
            expiresAt: Date.now() + VOLUME_CACHE_TTL_MS,
            generatedAt: Date.now(),
            tokens: [],
            failedEndpoints: [],
        }
    }
    const listed = await loadTokenList(signal)
    const since = Math.floor(Date.now() / 1_000) - 24 * 60 * 60
    const outcomes = await Promise.allSettled(endpoints.map((endpoint) =>
        fetchEndpointVolume({
            chainId,
            endpoint,
            listed,
            since,
            signal,
        })))
    const aggregated = new Map<string, VolumeToken>()
    const failedEndpoints: string[] = []
    outcomes.forEach((outcome, index) => {
        if (outcome.status === 'rejected') {
            failedEndpoints.push(endpoints[index])
            return
        }
        for (const [address, metrics] of outcome.value) {
            const metadata = listed.get(tokenKey(chainId, address))
            if (!metadata) continue
            const current = aggregated.get(address)
            if (!current) {
                aggregated.set(address, {
                    ...metadata,
                    priceUSD: metrics.priceUSD,
                    volume24hUsd: metrics.volume24hUsd,
                    liquidityUsd: metrics.liquidityUsd,
                })
                continue
            }
            current.volume24hUsd += metrics.volume24hUsd
            current.liquidityUsd = Math.max(
                current.liquidityUsd,
                metrics.liquidityUsd,
            )
            current.priceUSD ??= metrics.priceUSD
        }
    })
    const tokens = [...aggregated.values()].sort((left, right) =>
        right.volume24hUsd - left.volume24hUsd ||
        right.liquidityUsd - left.liquidityUsd ||
        left.symbol.localeCompare(right.symbol))
    return {
        generatedAt: Date.now(),
        expiresAt: Date.now() + VOLUME_CACHE_TTL_MS,
        tokens,
        failedEndpoints,
    }
}

async function getChainCatalog(chainId: number, signal?: AbortSignal) {
    const key = String(chainId)
    const cached = volumeCache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached
    let request = pending.get(key)
    if (!request) {
        request = buildChainCatalog(chainId, signal).finally(() => {
            pending.delete(key)
        })
        pending.set(key, request)
    }
    const value = await request
    volumeCache.set(key, value)
    return value
}

function publicToken(token: VolumeToken, rank: number) {
    const chain = getTokenDiscoveryChain(token.chainId)!
    const id = createTokenId(token.chainId, token.address)
    return {
        id,
        canonicalId: id,
        chainId: token.chainId,
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        logoURI: token.logoURI,
        logoCandidates: [token.logoURI, '/icons/token-fallback.svg'],
        logoSource: 'curated',
        chainLogoURI: chain.chainLogoURI,
        coinGeckoId: null,
        priceUSD: token.priceUSD,
        trustedPriceUSD: token.priceUSD,
        marketPriceUSD: token.priceUSD,
        priceConfidence: token.priceUSD ? 'trusted' : 'unknown',
        priceChange24hPercent: null,
        volume24hUsd: token.volume24hUsd,
        volume7dUsd: null,
        volume30dUsd: null,
        liquidityUsd: token.liquidityUsd,
        trustedLiquidityUsd: token.liquidityUsd,
        largestTrustedPoolLiquidityUsd: token.liquidityUsd,
        fdvUsd: null,
        transactions24h: null,
        transactionCount24h: null,
        uniqueTraders24h: null,
        poolsCount: null,
        createdAt: null,
        hasProviderImage: true,
        pairCount: 1,
        trustedPairCount: 1,
        oldestPairCreatedAt: null,
        oldestTrustedPoolCreatedAt: null,
        establishedAgeDays: null,
        estimatedSellValueUsd: null,
        classificationTier: 'established',
        classificationReasons: [
            'uniswap-default-token-list',
            'uniswap-24h-volume',
        ],
        includeInPortfolioValue: true,
        marketUrl: null,
        rank,
        verificationStatus: 'established',
        verificationReasons: [
            'curated-token-allowlist',
            'uniswap-default-token-list',
            'uniswap-24h-volume',
        ],
        recognitionReasons: [
            'curated-token-allowlist',
            'uniswap-default-token-list',
            'uniswap-24h-volume',
        ],
        possibleSpam: false,
        visibility: 'primary',
        securityStatus: 'unknown',
        isNative: false,
        recognitionStatus: 'established',
        verifiedContract: true,
        officialAsset: false,
        spamStatus: 'clean',
        marketSource: 'curated',
        source: 'curated',
        catalogSection: 'volume',
    }
}

function normalizedQuery(value: unknown) {
    return String(value ?? '').trim().toLowerCase()
}

export const uniswapVolumeTokenRoutes: FastifyPluginAsync = async (app) => {
    app.get<{ Querystring: Query }>(
        '/v1/uniswap-volume-tokens',
        {
            schema: {
                querystring: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        chainId: {
                            type: 'string',
                            pattern: '^(?:all|[1-9][0-9]*)$',
                        },
                        limit: {
                            type: 'string',
                            pattern: '^[1-9][0-9]{0,3}$',
                        },
                        q: {
                            type: 'string',
                            maxLength: MAX_QUERY_LENGTH,
                        },
                    },
                },
            },
            config: {
                rateLimit: { max: 120, timeWindow: '1 minute' },
            },
        },
        async (request, reply) => {
            const scope = request.query.chainId?.toLowerCase() ?? 'all'
            const chainId = scope === 'all' ? null : Number(scope)
            if (chainId !== null && !getTokenDiscoveryChain(chainId)?.active) {
                return reply.code(400).send({
                    error: {
                        code: 'UNSUPPORTED_CHAIN',
                        message: 'The requested chain is not enabled.',
                    },
                })
            }
            const configured = endpointMap()
            const requestedChainIds = chainId === null
                ? ACTIVE_TOKEN_DISCOVERY_CHAINS
                      .map((chain) => chain.chainId)
                      .filter((value) => configured.has(value))
                : configured.has(chainId) ? [chainId] : []
            if (requestedChainIds.length === 0) {
                return reply.code(503).send({
                    error: {
                        code: 'UNISWAP_VOLUME_NOT_CONFIGURED',
                        message: 'No Uniswap subgraph is configured for this chain scope.',
                    },
                })
            }

            const results = await Promise.all(requestedChainIds.map((value) =>
                getChainCatalog(value, request.raw.signal)))
            const query = normalizedQuery(request.query.q)
            const defaultLimit = chainId === null ? 2_400 : 100
            const limit = Math.min(Number(request.query.limit ?? defaultLimit), 2_400)
            const flattened = results.flatMap((result) => result.tokens)
                .filter((token) => !query ||
                    token.name.toLowerCase().includes(query) ||
                    token.symbol.toLowerCase().includes(query) ||
                    token.address.includes(query))
                .sort((left, right) =>
                    right.volume24hUsd - left.volume24hUsd ||
                    right.liquidityUsd - left.liquidityUsd ||
                    left.symbol.localeCompare(right.symbol))
                .slice(0, limit)
                .map((token, index) => publicToken(token, index + 1))
            const generatedAt = Math.min(...results.map((result) => result.generatedAt))
            const partial = results.some((result) => result.failedEndpoints.length > 0)
            const response = {
                schemaVersion: 7,
                generatedAt,
                tokens: flattened,
                count: flattened.length,
                commonTokens: [],
                commonCount: 0,
                fallbackTokens: [],
                fallbackCount: 0,
                stale: false,
                partial,
                hardStale: false,
                catalogUnavailable: flattened.length === 0,
                chainErrors: {},
                metadata: {
                    source: 'uniswap-public-subgraphs',
                    configuredChainIds: requestedChainIds,
                    failedEndpointCount: results.reduce(
                        (sum, result) => sum + result.failedEndpoints.length,
                        0,
                    ),
                    providerPartial: partial,
                },
                query,
            }
            const etag = `"${createHash('sha256')
                .update(JSON.stringify(response))
                .digest('hex')}"`
            if (request.headers['if-none-match'] === etag) {
                return reply.code(304).send()
            }
            reply.header('etag', etag)
            reply.header('cache-control', 'public, max-age=30, stale-while-revalidate=120')
            return response
        },
    )
}

export function clearUniswapVolumeCachesForTest() {
    tokenListCache = null
    volumeCache.clear()
    pending.clear()
}
