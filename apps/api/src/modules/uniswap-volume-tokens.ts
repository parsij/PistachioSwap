import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { FastifyPluginAsync } from 'fastify'

import {
    createTokenId,
    normalizeAddress,
} from '../lib/address.js'
import { fetchJson, isRecord } from '../lib/http.js'
import { getTokenDiscoveryChain } from '../token-discovery/registry.js'

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
    source: string
    protocols: string[]
}

type SourceDiagnostic = {
    chainId: number
    protocol: 'v3' | 'v4' | 'override'
    subgraphId: string | null
    status: 'success' | 'failed' | 'not-configured' | 'missing-api-key'
    tokenRows: number
    error: string | null
}

export type UniswapVolumeCatalog = {
    schemaVersion: 1
    generatedAt: string
    source: 'uniswap-volume-token-catalog'
    configuredChainIds: number[]
    successfulChainIds: number[]
    failedChainIds: number[]
    stale: boolean
    partial: boolean
    tokens: VolumeToken[]
    diagnostics: {
        tokenListUrl: string
        registryVersion: string
        sources: SourceDiagnostic[]
        missingApiKey: boolean
        persisted: boolean
    }
}

type Query = {
    chainId?: string
    limit?: string
    q?: string
}

const DATA_PATH = path.resolve(
    process.cwd(),
    'data/uniswap-volume-token-catalog.v1.json',
)
const ROOT_DATA_PATH = path.resolve(
    process.cwd(),
    'apps/api/data/uniswap-volume-token-catalog.v1.json',
)
const TOKEN_LIST_TTL_MS = 6 * 60 * 60 * 1000
const REFRESH_STALE_MS = 30 * 60 * 1000
const MAX_ROWS_PER_ENDPOINT = 1_000
const MAX_QUERY_LENGTH = 80
const REGISTRY_VERSION = '2026-07-24'

const VERIFIED_SUBGRAPHS: Record<number, Array<{
    protocol: 'v3' | 'v4'
    network: string
    subgraphId: string
    evidence: string
}>> = {
    56: [{
        protocol: 'v3',
        network: 'bsc',
        subgraphId: 'F85MNzUGYqgSHSHRGgeVMNsdnW1KtZSVgFULumXRZTw2',
        evidence: 'The Graph Explorer lists Uniswap V3 BSC on network bsc with 100% indexing.',
    }],
}

let tokenListCache: {
    expiresAt: number
    values: Map<string, ListedToken>
} | null = null
let persistedCatalog: UniswapVolumeCatalog | null = null
let refreshPromise: Promise<UniswapVolumeCatalog> | null = null

function catalogPath() {
    const configured = process.env.UNISWAP_VOLUME_CATALOG_PATH?.trim()
    if (configured) return path.resolve(configured)
    return process.cwd().endsWith('/apps/api') ? DATA_PATH : ROOT_DATA_PATH
}

function readBoolean(name: string, fallback: boolean) {
    const value = process.env[name]?.trim().toLowerCase()
    if (!value) return fallback
    if (value === 'true') return true
    if (value === 'false') return false
    throw new Error(`${name} must be true or false.`)
}

function graphGatewayUrl(subgraphId: string) {
    const apiKey = process.env.THE_GRAPH_API_KEY?.trim()
    if (!apiKey) return null
    return `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`
}

function parseOverrideEndpoints() {
    const raw = process.env.UNISWAP_SUBGRAPH_URLS_JSON?.trim()
    if (!raw || raw === '{}') return new Map<number, string[]>()
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
        const values = Array.isArray(configured) ? configured : [configured]
        const urls = values.flatMap((value) => {
            if (typeof value !== 'string' || !value.trim()) return []
            const url = new URL(value.trim())
            if (url.protocol !== 'https:' || url.username || url.password) return []
            return [url.toString()]
        })
        if (urls.length > 0) result.set(chainId, [...new Set(urls)])
    }
    return result
}

function configuredSources() {
    const override = parseOverrideEndpoints()
    if (override.size > 0) {
        return [...override.entries()].flatMap(([chainId, urls]) =>
            urls.map((url) => ({
                chainId,
                protocol: 'override' as const,
                subgraphId: null,
                url,
            })))
    }
    return Object.entries(VERIFIED_SUBGRAPHS).flatMap(([chainIdText, entries]) =>
        entries.flatMap((entry) => {
            const url = graphGatewayUrl(entry.subgraphId)
            return [{
                chainId: Number(chainIdText),
                protocol: entry.protocol,
                subgraphId: entry.subgraphId,
                url,
            }]
        }))
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

async function fetchSourceVolume({
    chainId,
    protocol,
    subgraphId,
    url,
    listed,
    since,
    signal,
}: {
    chainId: number
    protocol: 'v3' | 'v4' | 'override'
    subgraphId: string | null
    url: string
    listed: Map<string, ListedToken>
    since: number
    signal?: AbortSignal
}) {
    const payload = await fetchJson(new URL(url), {
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
        dedupeKey: `uniswap-volume:${chainId}:${protocol}:${subgraphId ?? url}:${Math.floor(since / 300)}`,
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

function emptyCatalog(sources: ReturnType<typeof configuredSources>): UniswapVolumeCatalog {
    const configuredChainIds = [...new Set(sources.map((source) => source.chainId))]
        .sort((left, right) => left - right)
    const missingApiKey = sources.some((source) => source.url === null)
    return {
        schemaVersion: 1,
        generatedAt: new Date(0).toISOString(),
        source: 'uniswap-volume-token-catalog',
        configuredChainIds,
        successfulChainIds: [],
        failedChainIds: missingApiKey ? configuredChainIds : [],
        stale: true,
        partial: true,
        tokens: [],
        diagnostics: {
            tokenListUrl: process.env.UNISWAP_TOKEN_LIST_URL?.trim() ||
                'https://tokens.uniswap.org',
            registryVersion: REGISTRY_VERSION,
            sources: sources.map((source) => ({
                chainId: source.chainId,
                protocol: source.protocol,
                subgraphId: source.subgraphId,
                status: source.url ? 'not-configured' : 'missing-api-key',
                tokenRows: 0,
                error: source.url ? null : 'THE_GRAPH_API_KEY is required for built-in subgraphs.',
            })),
            missingApiKey,
            persisted: false,
        },
    }
}

function validateCatalog(value: unknown): UniswapVolumeCatalog | null {
    if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.tokens)) {
        return null
    }
    const deduped = new Map<string, VolumeToken>()
    for (const candidate of value.tokens) {
        if (!isRecord(candidate)) return null
        const chainId = Number(candidate.chainId)
        const address = normalizeAddress(candidate.address)
        const decimals = validDecimals(candidate.decimals)
        const name = cleanText(candidate.name, 120)
        const symbol = cleanText(candidate.symbol, 32)
        const logoURI = cleanText(candidate.logoURI, 2_048)
        const volume24hUsd = decimalNumber(candidate.volume24hUsd)
        const liquidityUsd = decimalNumber(candidate.liquidityUsd)
        if (!Number.isSafeInteger(chainId) || !address || decimals === null ||
            !name || !symbol || !logoURI || volume24hUsd === null ||
            liquidityUsd === null) return null
        if (deduped.has(tokenKey(chainId, address))) continue
        deduped.set(tokenKey(chainId, address), {
            chainId,
            address,
            name,
            symbol,
            decimals,
            logoURI,
            priceUSD: decimalText(candidate.priceUSD) ?? null,
            volume24hUsd,
            liquidityUsd,
            source: cleanText(candidate.source, 120) ?? 'uniswap-volume',
            protocols: Array.isArray(candidate.protocols)
                ? candidate.protocols.filter((protocol) => typeof protocol === 'string')
                : ['v3'],
        })
    }
    return {
        schemaVersion: 1,
        generatedAt: typeof value.generatedAt === 'string'
            ? value.generatedAt
            : new Date(0).toISOString(),
        source: 'uniswap-volume-token-catalog',
        configuredChainIds: Array.isArray(value.configuredChainIds)
            ? value.configuredChainIds.map(Number).filter(Number.isSafeInteger)
            : [],
        successfulChainIds: Array.isArray(value.successfulChainIds)
            ? value.successfulChainIds.map(Number).filter(Number.isSafeInteger)
            : [],
        failedChainIds: Array.isArray(value.failedChainIds)
            ? value.failedChainIds.map(Number).filter(Number.isSafeInteger)
            : [],
        stale: value.stale === true,
        partial: value.partial === true,
        tokens: [...deduped.values()].sort((left, right) =>
            right.volume24hUsd - left.volume24hUsd ||
            right.liquidityUsd - left.liquidityUsd ||
            left.symbol.localeCompare(right.symbol)),
        diagnostics: isRecord(value.diagnostics)
            ? value.diagnostics as UniswapVolumeCatalog['diagnostics']
            : emptyCatalog([]).diagnostics,
    }
}

export async function loadPersistedUniswapVolumeCatalog() {
    try {
        const parsed = JSON.parse(await readFile(catalogPath(), 'utf8')) as unknown
        const validated = validateCatalog(parsed)
        if (!validated) return null
        persistedCatalog = {
            ...validated,
            diagnostics: {
                ...validated.diagnostics,
                persisted: true,
            },
        }
        return persistedCatalog
    } catch {
        return null
    }
}

export async function buildUniswapVolumeCatalog({
    signal,
} : {
    signal?: AbortSignal
} = {}) {
    const sources = configuredSources()
    const enabled = readBoolean('UNISWAP_VOLUME_ENABLED', true)
    if (!enabled) return emptyCatalog([])
    const missingApiKey = sources.some((source) => source.url === null)
    const runnableSources = sources.filter((source): source is typeof source & { url: string } =>
        typeof source.url === 'string' && source.url.length > 0)
    if (runnableSources.length === 0) return emptyCatalog(sources)

    const listed = await loadTokenList(signal)
    const since = Math.floor(Date.now() / 1_000) - 24 * 60 * 60
    const seenSource = new Set<string>()
    const sourceDiagnostics: SourceDiagnostic[] = []
    const aggregated = new Map<string, VolumeToken>()
    await Promise.all(runnableSources.map(async (source) => {
        const sourceKey = `${source.chainId}:${source.protocol}:${source.subgraphId ?? source.url}`
        if (seenSource.has(sourceKey)) return
        seenSource.add(sourceKey)
        try {
            const rows = await fetchSourceVolume({
                ...source,
                url: source.url,
                listed,
                since,
                signal,
            })
            sourceDiagnostics.push({
                chainId: source.chainId,
                protocol: source.protocol,
                subgraphId: source.subgraphId,
                status: 'success',
                tokenRows: rows.size,
                error: null,
            })
            for (const [address, metrics] of rows) {
                const metadata = listed.get(tokenKey(source.chainId, address))
                if (!metadata) continue
                const key = tokenKey(source.chainId, address)
                const current = aggregated.get(key)
                if (!current) {
                    aggregated.set(key, {
                        ...metadata,
                        priceUSD: metrics.priceUSD,
                        volume24hUsd: metrics.volume24hUsd,
                        liquidityUsd: metrics.liquidityUsd,
                        source: `uniswap-${source.protocol}`,
                        protocols: [source.protocol],
                    })
                    continue
                }
                current.volume24hUsd += metrics.volume24hUsd
                current.liquidityUsd = Math.max(current.liquidityUsd, metrics.liquidityUsd)
                current.priceUSD ??= metrics.priceUSD
                if (!current.protocols.includes(source.protocol)) {
                    current.protocols.push(source.protocol)
                }
            }
        } catch (error) {
            sourceDiagnostics.push({
                chainId: source.chainId,
                protocol: source.protocol,
                subgraphId: source.subgraphId,
                status: 'failed',
                tokenRows: 0,
                error: error instanceof Error ? error.message : 'Unknown provider failure.',
            })
        }
    }))
    if (missingApiKey) {
        sourceDiagnostics.push(...sources
            .filter((source) => source.url === null)
            .map((source) => ({
                chainId: source.chainId,
                protocol: source.protocol,
                subgraphId: source.subgraphId,
                status: 'missing-api-key' as const,
                tokenRows: 0,
                error: 'THE_GRAPH_API_KEY is required for built-in subgraphs.',
            })))
    }
    const successfulChainIds = [...new Set(sourceDiagnostics
        .filter((source) => source.status === 'success')
        .map((source) => source.chainId))]
        .sort((left, right) => left - right)
    const configuredChainIds = [...new Set(sources.map((source) => source.chainId))]
        .sort((left, right) => left - right)
    const failedChainIds = configuredChainIds
        .filter((chainId) => !successfulChainIds.includes(chainId))
    const tokens = [...aggregated.values()].sort((left, right) =>
        right.volume24hUsd - left.volume24hUsd ||
        right.liquidityUsd - left.liquidityUsd ||
        left.symbol.localeCompare(right.symbol))
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        source: 'uniswap-volume-token-catalog',
        configuredChainIds,
        successfulChainIds,
        failedChainIds,
        stale: false,
        partial: failedChainIds.length > 0,
        tokens,
        diagnostics: {
            tokenListUrl: process.env.UNISWAP_TOKEN_LIST_URL?.trim() ||
                'https://tokens.uniswap.org',
            registryVersion: REGISTRY_VERSION,
            sources: sourceDiagnostics.sort((left, right) =>
                left.chainId - right.chainId ||
                left.protocol.localeCompare(right.protocol)),
            missingApiKey,
            persisted: false,
        },
    } satisfies UniswapVolumeCatalog
}

export async function writeUniswapVolumeCatalogAtomic(
    catalog: UniswapVolumeCatalog,
) {
    const validated = validateCatalog(catalog)
    if (!validated || validated.tokens.length === 0) {
        throw new Error('Refusing to persist an invalid or empty Uniswap volume catalog.')
    }
    const target = catalogPath()
    await mkdir(path.dirname(target), { recursive: true })
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temp, `${JSON.stringify(validated, null, 2)}\n`, 'utf8')
    await rename(temp, target)
    persistedCatalog = {
        ...validated,
        diagnostics: { ...validated.diagnostics, persisted: true },
    }
    return target
}

export async function refreshUniswapVolumeCatalog({
    persist = false,
    signal,
}: {
    persist?: boolean
    signal?: AbortSignal
} = {}) {
    const previous = persistedCatalog ?? await loadPersistedUniswapVolumeCatalog()
    let fresh: UniswapVolumeCatalog
    try {
        fresh = await buildUniswapVolumeCatalog({ signal })
    } catch (error) {
        if (!previous) throw error
        return {
            ...previous,
            stale: true,
            partial: true,
            diagnostics: {
                ...previous.diagnostics,
                sources: [{
                    chainId: 56,
                    protocol: 'v3' as const,
                    subgraphId: VERIFIED_SUBGRAPHS[56]?.[0]?.subgraphId ?? null,
                    status: 'failed' as const,
                    tokenRows: 0,
                    error: error instanceof Error ? error.message : 'Unknown refresh failure.',
                }],
                persisted: true,
            },
        }
    }
    if (fresh.tokens.length === 0 && previous && previous.tokens.length > 0) {
        return {
            ...previous,
            stale: true,
            partial: true,
            diagnostics: {
                ...previous.diagnostics,
                sources: fresh.diagnostics.sources,
                missingApiKey: fresh.diagnostics.missingApiKey,
                persisted: true,
            },
        }
    }
    if (persist && fresh.tokens.length > 0) {
        await writeUniswapVolumeCatalogAtomic(fresh)
    }
    persistedCatalog = fresh
    return fresh
}

export async function getUniswapVolumeCatalog({
    refreshIfStale = true,
} = {}) {
    const loaded = persistedCatalog ?? await loadPersistedUniswapVolumeCatalog()
    const fallback = loaded ?? emptyCatalog(configuredSources())
    const generated = Date.parse(fallback.generatedAt)
    const stale = !Number.isFinite(generated) ||
        Date.now() - generated > REFRESH_STALE_MS ||
        fallback.stale
    if (refreshIfStale && stale && !refreshPromise &&
        process.env.THE_GRAPH_API_KEY?.trim()) {
        refreshPromise = refreshUniswapVolumeCatalog({ persist: true })
            .catch(() => fallback)
            .finally(() => {
                refreshPromise = null
            })
    }
    return { ...fallback, stale }
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
        marketSource: token.source,
        source: token.source,
        catalogSection: 'volume',
    }
}

function normalizedQuery(value: unknown) {
    return String(value ?? '').trim().toLowerCase()
}

function rankScore(token: VolumeToken, query: string) {
    if (!query) return 0
    if (token.address === query) return 4
    if (token.symbol.toLowerCase() === query) return 3
    if (token.name.toLowerCase() === query) return 2
    if (token.symbol.toLowerCase().startsWith(query)) return 1
    return 0
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
            const catalog = await getUniswapVolumeCatalog()
            const configuredChainIds = catalog.configuredChainIds
            const requestedChainIds = chainId === null
                ? configuredChainIds
                : configuredChainIds.includes(chainId) ? [chainId] : []
            const query = normalizedQuery(request.query.q)
            const limit = Math.min(
                Number(request.query.limit ?? (chainId === null ? 2_400 : 100)),
                2_400,
            )
            const tokens = catalog.tokens
                .filter((token) => requestedChainIds.includes(token.chainId))
                .filter((token) => !query ||
                    token.name.toLowerCase().includes(query) ||
                    token.symbol.toLowerCase().includes(query) ||
                    token.address.includes(query))
                .sort((left, right) =>
                    rankScore(right, query) - rankScore(left, query) ||
                    right.volume24hUsd - left.volume24hUsd ||
                    right.liquidityUsd - left.liquidityUsd ||
                    left.symbol.localeCompare(right.symbol))
                .slice(0, limit)
                .map((token, index) => publicToken(token, index + 1))
            const response = {
                schemaVersion: 7,
                generatedAt: catalog.generatedAt,
                stale: catalog.stale,
                partial: catalog.partial,
                configuredChainIds,
                successfulChainIds: catalog.successfulChainIds,
                failedChainIds: catalog.failedChainIds,
                tokens,
                count: tokens.length,
                commonTokens: [],
                commonCount: 0,
                fallbackTokens: [],
                fallbackCount: 0,
                hardStale: catalog.stale,
                catalogUnavailable: tokens.length === 0,
                chainErrors: Object.fromEntries(catalog.failedChainIds.map((id) => [
                    String(id),
                    'Uniswap volume data is unavailable for this chain.',
                ])),
                metadata: {
                    source: catalog.source,
                    diagnostics: catalog.diagnostics,
                    providerPartial: catalog.partial,
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
            reply.header(
                'cache-control',
                'public, max-age=30, stale-while-revalidate=300',
            )
            return response
        },
    )
}

export function clearUniswapVolumeCachesForTest() {
    tokenListCache = null
    persistedCatalog = null
    refreshPromise = null
}
