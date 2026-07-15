import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { FastifyPluginAsync, FastifyReply } from 'fastify'

import { getApiConfig } from '../config.js'
import {
    NATIVE_TOKEN_ADDRESS,
    createTokenId,
    normalizeAddress,
} from '../lib/address.js'
import { ProviderError, getSafeError } from '../lib/errors.js'
import { nativeBnbMarketToken } from '../lib/native-token.js'
import {
    type TokenMetadata,
    getTokenMetadataBatch,
} from '../providers/alchemy/token-metadata.js'
import {
    type CoinGeckoToken,
    getCoinGeckoToken,
    getCoinGeckoTokensBatch,
} from '../providers/coingecko/token-data.js'
import { searchCoinGeckoTokens } from '../providers/coingecko/token-search.js'
import {
    type TokenMarket,
    type TokenMarketBatchResult,
    fetchTokenMarkets,
} from '../providers/dexscreener/token-markets.js'
import {
    rankSearchResults,
    searchTokens,
} from '../providers/dexscreener/token-search.js'
import {
    type CandidateDiscoveryResult,
    type DiscoveredTokenCandidate,
    discoverTopPoolTokens,
} from '../providers/geckoterminal/top-pools.js'
import { validateTokenLogoEntries } from '../providers/logo-validator.js'
import { getTokenDecimalsBatch } from '../providers/token-decimals.js'
import {
    type LogoSource,
    buildTokenLogo,
    getTokenLogoEntries,
} from '../providers/token-logos.js'

type TokenCandidate =
    | CoinGeckoToken
    | DiscoveredTokenCandidate
    | {
          address: string
          name: string | null
          symbol: string | null
          decimals: number | null
          imageUrl: null
          coinGeckoId: null
          priceUSD: string | null
          imageSource: null
      }

export type VerificationStatus =
    | 'established'
    | 'recognized'
    | 'unverified'

export type MarketToken = {
    id: string
    chainId: number
    address: string
    name: string
    symbol: string
    decimals: number
    logoURI: string | null
    logoCandidates: string[]
    logoSource: LogoSource
    chainLogoURI: string | null
    coinGeckoId: string | null
    priceUSD: string | null
    volume24hUsd: number
    liquidityUsd: number
    pairCount: number
    oldestPairCreatedAt: string | null
    marketUrl: string | null
    rank: number | null
    verificationStatus: VerificationStatus
    verificationReasons: string[]
}

export type CatalogStats = {
    candidatesInspected: number
    recognizedCandidates: number
    establishedTokens: number
    pagesCompleted: number
    providerPartial: boolean
    providerFailures: {
        geckoTerminalPagination: boolean
        coinGeckoFailedBatches: number
        dexScreenerFailedBatches: number
    }
    exclusionReasons: Record<string, number>
}

type CatalogCache = {
    generatedAt: number
    expiresAt: number
    staleUntil: number
    partial: boolean
    tokens: MarketToken[]
    stats: CatalogStats
}

type SearchCache = {
    expiresAt: number
    tokens: MarketToken[]
}

type Snapshot = Pick<CatalogCache, 'generatedAt' | 'tokens' | 'stats'>

export type MarketDependencies = {
    discoverCandidates: typeof discoverTopPoolTokens
    fetchMarkets: typeof fetchTokenMarkets
    fetchRecognized: typeof getCoinGeckoTokensBatch
    searchMarkets: typeof searchTokens
    searchCandidates: typeof searchCoinGeckoTokens
    fetchTokenInfo: typeof getCoinGeckoToken
    fetchMetadata: typeof getTokenMetadataBatch
    fetchDecimals: typeof getTokenDecimalsBatch
    validateLogos: typeof validateTokenLogoEntries
    loadSnapshot: () => Promise<Snapshot | null>
    saveSnapshot: (snapshot: Snapshot) => Promise<void>
    now: () => number
}

const SNAPSHOT_PATH = fileURLToPath(
    new URL('../../data/bsc-established-top-tokens.json', import.meta.url),
)

function normalizedText(value: string | null | undefined, maximum: number) {
    const normalized = value?.trim() ?? ''
    return normalized && normalized.length <= maximum ? normalized : null
}

function validDecimals(value: unknown): value is number {
    return (
        Number.isInteger(value) &&
        Number(value) >= 0 &&
        Number(value) <= 255
    )
}

function isEstablishedSnapshotToken(value: unknown): value is MarketToken {
    if (typeof value !== 'object' || value === null) return false
    const token = value as Partial<MarketToken>
    return (
        token.chainId === 56 &&
        normalizeAddress(token.address) !== null &&
        token.verificationStatus === 'established' &&
        typeof token.coinGeckoId === 'string' &&
        token.coinGeckoId.length > 0 &&
        typeof token.logoURI === 'string' &&
        token.logoURI.length > 0 &&
        validDecimals(token.decimals)
    )
}

async function loadCatalogSnapshot(): Promise<Snapshot | null> {
    if (!getApiConfig().market.snapshotEnabled) return null

    try {
        const parsed = JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8')) as {
            generatedAt?: unknown
            tokens?: unknown
            stats?: unknown
        }
        if (
            !Number.isFinite(parsed.generatedAt) ||
            !Array.isArray(parsed.tokens) ||
            parsed.tokens.length === 0 ||
            parsed.tokens.length > 100 ||
            !parsed.tokens.every(isEstablishedSnapshotToken) ||
            typeof parsed.stats !== 'object' ||
            parsed.stats === null
        ) {
            return null
        }
        return parsed as Snapshot
    } catch {
        return null
    }
}

async function saveCatalogSnapshot(snapshot: Snapshot) {
    if (!getApiConfig().market.snapshotEnabled || snapshot.tokens.length === 0) {
        return
    }

    await mkdir(dirname(SNAPSHOT_PATH), { recursive: true })
    const temporaryPath = `${SNAPSHOT_PATH}.${process.pid}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
    })
    await rename(temporaryPath, SNAPSHOT_PATH)
}

function candidateFromMarket(market: TokenMarket): TokenCandidate {
    return {
        address: market.address,
        name: normalizedText(market.name, 120),
        symbol: normalizedText(market.symbol, 32),
        decimals: null,
        imageUrl: null,
        coinGeckoId: null,
        priceUSD: market.priceUSD,
        imageSource: null,
    }
}

function emptyCandidate(address: string): TokenCandidate {
    return {
        address,
        name: null,
        symbol: null,
        decimals: null,
        imageUrl: null,
        coinGeckoId: null,
        priceUSD: null,
        imageSource: null,
    }
}

function uniqueCandidates(candidates: TokenCandidate[]) {
    const values = new Map<string, TokenCandidate>()
    for (const candidate of candidates) {
        const address = normalizeAddress(candidate.address)
        if (
            address &&
            address !== NATIVE_TOKEN_ADDRESS &&
            !values.has(address)
        ) {
            values.set(address, { ...candidate, address })
        }
    }
    return [...values.values()]
}

function asDiscoveryResult(
    value: CandidateDiscoveryResult | DiscoveredTokenCandidate[],
): CandidateDiscoveryResult {
    return Array.isArray(value)
        ? { candidates: value, pagesCompleted: 0, partial: false }
        : value
}

function asMarketResult(
    value: TokenMarketBatchResult | Map<string, TokenMarket>,
): TokenMarketBatchResult {
    return value instanceof Map
        ? {
              markets: value,
              partial: false,
              successfulBatches: value.size > 0 ? 1 : 0,
              failedBatches: 0,
          }
        : value
}

function isRecognizedToken(
    requestedAddress: string,
    token: CoinGeckoToken | undefined,
) {
    return Boolean(
        token &&
            token.address === requestedAddress &&
            normalizedText(token.coinGeckoId, 160) &&
            normalizedText(token.name, 120) &&
            normalizedText(token.symbol, 32),
    )
}

function marketReasons(
    market: TokenMarket | undefined,
    now: number,
) {
    const config = getApiConfig().market
    const reasons: string[] = []
    const failures: string[] = []

    if ((market?.liquidityUsd ?? 0) >= config.minimumLiquidityUsd) {
        reasons.push('minimum-liquidity-met')
    } else {
        failures.push('below-liquidity-threshold')
    }
    if ((market?.volume24hUsd ?? 0) >= config.minimumVolume24hUsd) {
        reasons.push('minimum-volume-met')
    } else {
        failures.push('below-volume-threshold')
    }
    if ((market?.pairCount ?? 0) >= config.minimumPairCount) {
        reasons.push('minimum-pair-count-met')
    } else {
        failures.push('below-pair-count-threshold')
    }

    const oldest = market?.oldestPairCreatedAt
        ? Date.parse(market.oldestPairCreatedAt)
        : Number.NaN
    const oldestAllowed =
        now - config.minimumPoolAgeDays * 24 * 60 * 60 * 1000
    if (Number.isFinite(oldest) && oldest <= oldestAllowed) {
        reasons.push('minimum-pool-age-met')
    } else {
        failures.push('pool-too-new-or-age-unavailable')
    }

    return { reasons, failures }
}

function incrementReasons(
    counts: Record<string, number>,
    reasons: string[],
) {
    for (const reason of new Set(reasons)) {
        counts[reason] = (counts[reason] ?? 0) + 1
    }
}

export function rankTokens(tokens: MarketToken[]) {
    return [...tokens]
        .sort((left, right) => {
            const volume = right.volume24hUsd - left.volume24hUsd
            if (volume !== 0) return volume
            const liquidity = right.liquidityUsd - left.liquidityUsd
            if (liquidity !== 0) return liquidity
            const pairs = right.pairCount - left.pairCount
            if (pairs !== 0) return pairs
            return left.symbol.localeCompare(right.symbol)
        })
        .map((token, index) => ({ ...token, rank: index + 1 }))
}

async function getOptionalMetadata(
    addresses: string[],
    dependencies: MarketDependencies,
) {
    if (!getApiConfig().alchemy.rpcUrl || addresses.length === 0) {
        return new Map<string, TokenMetadata | null>()
    }
    try {
        return await dependencies.fetchMetadata({ chainId: 56, addresses })
    } catch {
        return new Map<string, TokenMetadata | null>()
    }
}

async function getMissingDecimals(
    candidates: TokenCandidate[],
    metadata: Map<string, TokenMetadata | null>,
    dependencies: MarketDependencies,
) {
    const addresses = candidates
        .filter(
            (candidate) =>
                !validDecimals(candidate.decimals) &&
                !validDecimals(metadata.get(candidate.address)?.decimals),
        )
        .map((candidate) => candidate.address)
    if (addresses.length === 0) return new Map<string, number | null>()
    try {
        return await dependencies.fetchDecimals({ addresses })
    } catch {
        return new Map<string, number | null>()
    }
}

async function buildEstablishedTokens({
    candidates,
    recognized,
    markets,
    dependencies,
    now,
}: {
    candidates: DiscoveredTokenCandidate[]
    recognized: Map<string, CoinGeckoToken>
    markets: Map<string, TokenMarket>
    dependencies: MarketDependencies
    now: number
}) {
    const config = getApiConfig()
    const exclusions: Record<string, number> = {}
    const recognizedCandidates: CoinGeckoToken[] = []

    for (const discovered of uniqueCandidates(candidates)) {
        const token = recognized.get(discovered.address)
        const reasons: string[] = []
        if (config.market.blocklist.has(discovered.address)) {
            reasons.push('manually-blocklisted')
        }
        if (!isRecognizedToken(discovered.address, token)) {
            reasons.push('coin-not-listed')
        }
        if (reasons.length > 0) {
            incrementReasons(exclusions, reasons)
        } else if (token) {
            recognizedCandidates.push(token)
        }
    }

    const metadata = await getOptionalMetadata(
        recognizedCandidates.map((token) => token.address),
        dependencies,
    )
    const rpcDecimals = await getMissingDecimals(
        recognizedCandidates,
        metadata,
        dependencies,
    )
    const evaluated: Array<MarketToken | null> = await Promise.all(recognizedCandidates.map(async (candidate): Promise<MarketToken | null> => {
        const market = markets.get(candidate.address)
        const checks = marketReasons(market, now)
        if (checks.failures.length > 0) {
            incrementReasons(exclusions, checks.failures)
            return null
        }

        const tokenMetadata = metadata.get(candidate.address)
        const decimals = validDecimals(tokenMetadata?.decimals)
            ? tokenMetadata.decimals
            : validDecimals(candidate.decimals)
              ? candidate.decimals
              : rpcDecimals.get(candidate.address)
        if (!validDecimals(decimals)) {
            incrementReasons(exclusions, ['decimals-unavailable'])
            return null
        }

        const logo = await dependencies.validateLogos(
            getTokenLogoEntries({
                address: candidate.address,
                coinGeckoImage: candidate.imageUrl,
                alchemyImage: tokenMetadata?.logoURI,
            }),
        )
        if (!logo) {
            incrementReasons(exclusions, ['logo-unavailable'])
            return null
        }

        return {
            id: createTokenId(config.chainId, candidate.address),
            chainId: config.chainId,
            address: candidate.address,
            name: candidate.name!.trim(),
            symbol: candidate.symbol!.trim(),
            decimals,
            ...logo,
            chainLogoURI: config.market.chainLogoUri,
            coinGeckoId: candidate.coinGeckoId!.trim(),
            priceUSD: market?.priceUSD ?? candidate.priceUSD,
            volume24hUsd: market?.volume24hUsd ?? 0,
            liquidityUsd: market?.liquidityUsd ?? 0,
            pairCount: market?.pairCount ?? 0,
            oldestPairCreatedAt: market?.oldestPairCreatedAt ?? null,
            marketUrl: market?.pairUrl ?? null,
            rank: null,
            verificationStatus: 'established',
            verificationReasons: [
                'coingecko-exact-contract',
                ...checks.reasons,
                'validated-logo',
            ],
        }
    }))
    const tokens = evaluated.filter(
        (token): token is MarketToken => token !== null,
    )

    const wrapped = tokens.find(
        (token) => token.address === config.market.wrappedNativeAddress,
    )
    if (wrapped) {
        const nativeLogo = await dependencies.validateLogos(
            getTokenLogoEntries({
                address: NATIVE_TOKEN_ADDRESS,
                localImage: '/icons/bnb.svg',
            }),
        )
        if (nativeLogo) {
            tokens.push({
                ...wrapped,
                id: createTokenId(config.chainId, NATIVE_TOKEN_ADDRESS),
                address: NATIVE_TOKEN_ADDRESS,
                name: 'BNB',
                symbol: 'BNB',
                decimals: 18,
                ...nativeLogo,
                coinGeckoId: 'binancecoin',
                rank: null,
                verificationReasons: [
                    'explicit-native-allowlist',
                    ...wrapped.verificationReasons.filter(
                        (reason) => reason !== 'coingecko-exact-contract',
                    ),
                ],
            })
        }
    }

    return {
        tokens: rankTokens(tokens).slice(0, config.market.defaultLimit),
        exclusions,
        recognizedCount: recognizedCandidates.length,
    }
}

function verificationReasonsForSearch(
    recognized: boolean,
    market: TokenMarket | undefined,
    hasLogo: boolean,
    now: number,
) {
    const checks = marketReasons(market, now)
    return [
        recognized ? 'coingecko-exact-contract' : 'coin-not-listed',
        ...checks.reasons,
        ...checks.failures,
        ...(hasLogo ? [] : ['logo-unavailable']),
    ]
}

async function enrichSearchCandidates({
    candidates,
    markets,
    dependencies,
}: {
    candidates: TokenCandidate[]
    markets: Map<string, TokenMarket>
    dependencies: MarketDependencies
}) {
    const config = getApiConfig()
    const unique = uniqueCandidates(candidates)
    const metadata = await getOptionalMetadata(
        unique.map((candidate) => candidate.address),
        dependencies,
    )
    const rpcDecimals = await getMissingDecimals(unique, metadata, dependencies)
    const tokens: MarketToken[] = []

    for (const candidate of unique) {
        const market = markets.get(candidate.address)
        const tokenMetadata = metadata.get(candidate.address)
        const name =
            normalizedText(candidate.name, 120) ??
            normalizedText(tokenMetadata?.name, 120) ??
            normalizedText(market?.name, 120)
        const symbol =
            normalizedText(candidate.symbol, 32) ??
            normalizedText(tokenMetadata?.symbol, 32) ??
            normalizedText(market?.symbol, 32)
        const decimals = validDecimals(candidate.decimals)
            ? candidate.decimals
            : validDecimals(tokenMetadata?.decimals)
              ? tokenMetadata.decimals
              : rpcDecimals.get(candidate.address)
        if (!name || !symbol || !validDecimals(decimals)) continue

        const recognized = isRecognizedToken(
            candidate.address,
            candidate.imageSource === 'coingecko' ? candidate : undefined,
        )
        const logo = buildTokenLogo({
            address: candidate.address,
            coinGeckoImage:
                candidate.imageSource === 'coingecko'
                    ? candidate.imageUrl
                    : null,
            alchemyImage: tokenMetadata?.logoURI,
        })

        tokens.push({
            id: createTokenId(config.chainId, candidate.address),
            chainId: config.chainId,
            address: candidate.address,
            name,
            symbol,
            decimals,
            ...logo,
            chainLogoURI: config.market.chainLogoUri,
            coinGeckoId: recognized ? candidate.coinGeckoId : null,
            priceUSD: market?.priceUSD ?? candidate.priceUSD,
            volume24hUsd: market?.volume24hUsd ?? 0,
            liquidityUsd: market?.liquidityUsd ?? 0,
            pairCount: market?.pairCount ?? 0,
            oldestPairCreatedAt: market?.oldestPairCreatedAt ?? null,
            marketUrl: market?.pairUrl ?? null,
            rank: null,
            verificationStatus: recognized ? 'recognized' : 'unverified',
            verificationReasons: verificationReasonsForSearch(
                recognized,
                market,
                logo.logoCandidates.length > 0,
                dependencies.now(),
            ),
        })
    }

    return tokens
}

function rankBroaderSearch(tokens: MarketToken[], query: string) {
    const recognized = tokens.filter(
        (token) => token.verificationStatus === 'recognized',
    )
    const unverified = tokens.filter(
        (token) => token.verificationStatus !== 'recognized',
    )
    return [
        ...rankSearchResults(recognized, query),
        ...rankSearchResults(unverified, query),
    ]
        .map((token, index) => ({ ...token, rank: index + 1 }))
}

export function createMarketCatalogService(
    dependencies: Partial<MarketDependencies> = {},
) {
    const resolved: MarketDependencies = {
        discoverCandidates: discoverTopPoolTokens,
        fetchMarkets: fetchTokenMarkets,
        fetchRecognized: getCoinGeckoTokensBatch,
        searchMarkets: searchTokens,
        searchCandidates: searchCoinGeckoTokens,
        fetchTokenInfo: getCoinGeckoToken,
        fetchMetadata: getTokenMetadataBatch,
        fetchDecimals: getTokenDecimalsBatch,
        validateLogos: validateTokenLogoEntries,
        loadSnapshot: loadCatalogSnapshot,
        saveSnapshot: saveCatalogSnapshot,
        now: Date.now,
        ...dependencies,
    }
    let catalogCache: CatalogCache | null = null
    let snapshotLoaded = false
    let refreshPromise: Promise<CatalogCache> | null = null
    let nextRefreshAllowedAt = 0
    const searchCache = new Map<string, SearchCache>()

    async function loadSnapshotOnce() {
        if (snapshotLoaded) return
        snapshotLoaded = true
        const snapshot = await resolved.loadSnapshot()
        if (!snapshot) return
        const config = getApiConfig().market
        catalogCache = {
            ...snapshot,
            expiresAt: snapshot.generatedAt + config.catalogTtlMs,
            staleUntil: snapshot.generatedAt + config.staleTtlMs,
            partial: false,
        }
    }

    async function buildCatalog(): Promise<CatalogCache> {
        const config = getApiConfig()
        const discovery = asDiscoveryResult(
            await resolved.discoverCandidates({
                minimumCandidates: config.market.candidateLimit,
            }),
        )
        const candidates = uniqueCandidates(discovery.candidates).slice(
            0,
            config.market.candidateLimit,
        ) as DiscoveredTokenCandidate[]
        const [recognition, marketResult] = await Promise.all([
            resolved.fetchRecognized(
                candidates.map((candidate) => candidate.address),
            ),
            resolved.fetchMarkets(
                candidates.map((candidate) => candidate.address),
            ),
        ])
        const marketBatch = asMarketResult(marketResult)
        const generatedAt = resolved.now()
        const established = await buildEstablishedTokens({
            candidates,
            recognized: recognition.tokens,
            markets: marketBatch.markets,
            dependencies: resolved,
            now: generatedAt,
        })
        if (established.tokens.length === 0) {
            throw new ProviderError({
                code: 'MARKET_CATALOG_EMPTY',
                message:
                    'No established market tokens were returned by the configured providers.',
            })
        }

        const partial =
            discovery.partial || recognition.partial || marketBatch.partial
        const stats: CatalogStats = {
            candidatesInspected: candidates.length,
            recognizedCandidates: established.recognizedCount,
            establishedTokens: established.tokens.length,
            pagesCompleted: discovery.pagesCompleted,
            providerPartial: partial,
            providerFailures: {
                geckoTerminalPagination: discovery.partial,
                coinGeckoFailedBatches: recognition.failedBatches,
                dexScreenerFailedBatches: marketBatch.failedBatches,
            },
            exclusionReasons: established.exclusions,
        }

        return {
            generatedAt,
            expiresAt:
                generatedAt +
                (partial
                    ? config.market.partialRetryMs
                    : config.market.catalogTtlMs),
            staleUntil: generatedAt + config.market.staleTtlMs,
            partial,
            tokens: established.tokens,
            stats,
        }
    }

    function refreshCatalog() {
        if (refreshPromise) return refreshPromise

        refreshPromise = buildCatalog()
            .then(async (catalog) => {
                if (catalog.partial && catalogCache?.tokens.length) {
                    return catalogCache
                }
                catalogCache = catalog
                nextRefreshAllowedAt = 0
                if (!catalog.partial) {
                    await resolved
                        .saveSnapshot({
                            generatedAt: catalog.generatedAt,
                            tokens: catalog.tokens,
                            stats: catalog.stats,
                        })
                        .catch(() => {
                            // Snapshot persistence is optional.
                        })
                }
                return catalog
            })
            .finally(() => {
                refreshPromise = null
            })
        return refreshPromise
    }

    async function getCatalog() {
        await loadSnapshotOnce()
        const now = resolved.now()
        if (catalogCache && catalogCache.expiresAt > now) {
            return { catalog: catalogCache, stale: false }
        }
        if (catalogCache && catalogCache.staleUntil > now) {
            if (now >= nextRefreshAllowedAt) {
                nextRefreshAllowedAt =
                    now + getApiConfig().market.partialRetryMs
                void refreshCatalog().catch(() => {
                    // Keep the last known catalog during a provider outage.
                })
            }
            return { catalog: catalogCache, stale: true }
        }
        return { catalog: await refreshCatalog(), stale: false }
    }

    async function getExactAddressSearch(address: string) {
        const [tokenResult, marketResult] = await Promise.allSettled([
            resolved.fetchTokenInfo(address),
            resolved.searchMarkets(address),
        ])
        const token =
            tokenResult.status === 'fulfilled' ? tokenResult.value : null
        const marketValues =
            marketResult.status === 'fulfilled' ? marketResult.value : []
        const markets = new Map(
            marketValues.map((market) => [market.address, market]),
        )
        const exactMarket = markets.get(address)
        const candidate =
            token ??
            (exactMarket ? candidateFromMarket(exactMarket) : null) ??
            emptyCandidate(address)
        const tokens = await enrichSearchCandidates({
            candidates: [candidate],
            markets,
            dependencies: resolved,
        })

        if (
            tokens.length === 0 &&
            tokenResult.status === 'rejected' &&
            marketResult.status === 'rejected'
        ) {
            throw tokenResult.reason
        }
        return tokens.map((value, index) => ({ ...value, rank: index + 1 }))
    }

    async function getTextSearch(query: string) {
        let candidates: TokenCandidate[] = []
        let markets = new Map<string, TokenMarket>()
        let coinGeckoError: unknown
        let dexError: unknown

        try {
            candidates = await resolved.searchCandidates(query)
        } catch (error) {
            coinGeckoError = error
        }
        if (candidates.length > 0) {
            try {
                markets = asMarketResult(
                    await resolved.fetchMarkets(
                        candidates.map((candidate) => candidate.address),
                    ),
                ).markets
            } catch (error) {
                dexError = error
            }
        } else {
            try {
                const fallbackMarkets = await resolved.searchMarkets(query)
                markets = new Map(
                    fallbackMarkets.map((market) => [market.address, market]),
                )
                candidates = fallbackMarkets.map(candidateFromMarket)
            } catch (error) {
                dexError = error
            }
        }

        if (candidates.length === 0) {
            if (coinGeckoError && dexError) throw coinGeckoError
            return []
        }
        const tokens = await enrichSearchCandidates({
            candidates: candidates.slice(0, 20),
            markets,
            dependencies: resolved,
        })
        return rankBroaderSearch(tokens, query)
    }

    async function getSearch(query: string) {
        const config = getApiConfig()
        const cacheKey = `${config.chainId}:${query}`
        const cached = searchCache.get(cacheKey)
        if (cached && cached.expiresAt > resolved.now()) return cached.tokens

        const address = normalizeAddress(query)
        const tokens = (
            address
                ? await getExactAddressSearch(address)
                : await getTextSearch(query)
        ).slice(0, config.market.searchLimit)
        searchCache.set(cacheKey, {
            tokens,
            expiresAt: resolved.now() + config.market.searchTtlMs,
        })
        return tokens
    }

    return { getCatalog, getSearch, refreshCatalog }
}

type TokenQuery = {
    q?: string
    limit?: string
    chainId?: string
}

function parseLimit(value: string | undefined, maximum: number) {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0
        ? Math.min(parsed, maximum)
        : maximum
}

function sendUnsupportedChain(reply: FastifyReply) {
    return reply.code(400).send({
        error: {
            code: 'UNSUPPORTED_CHAIN',
            message: 'Only BNB Chain (56) is supported.',
        },
    })
}

export function createMarketTokenRoutes(
    service = createMarketCatalogService(),
): FastifyPluginAsync {
    return async (app) => {
        app.get<{ Querystring: TokenQuery }>(
            '/v1/market-tokens',
            async (request, reply) => {
                const config = getApiConfig()
                const chainId = request.query.chainId
                    ? Number(request.query.chainId)
                    : config.chainId
                if (!config.allowedChains.has(chainId)) {
                    return sendUnsupportedChain(reply)
                }

                const query = (request.query.q ?? '').trim().toLowerCase()
                if (query.length > config.market.maximumQueryLength) {
                    return reply.code(400).send({
                        error: {
                            code: 'QUERY_TOO_LONG',
                            message: `Search queries cannot exceed ${config.market.maximumQueryLength} characters.`,
                        },
                    })
                }

                const maximum = query
                    ? config.market.searchLimit
                    : config.market.defaultLimit
                const limit = parseLimit(request.query.limit, maximum)

                try {
                    if (query) {
                        const nativeQuery =
                            query === NATIVE_TOKEN_ADDRESS ||
                            ['bnb', 'binance coin', 'native bnb'].includes(query)
                        const searched = nativeQuery && query === NATIVE_TOKEN_ADDRESS
                            ? []
                            : await service.getSearch(query)
                        const wrapped = searched.find(
                            (token) => token.address === config.market.wrappedNativeAddress,
                        )
                        const tokens = nativeQuery
                            ? [
                                  nativeBnbMarketToken(wrapped?.priceUSD ?? null),
                                  ...searched.filter(
                                      (token) => token.address !== NATIVE_TOKEN_ADDRESS,
                                  ),
                              ]
                            : searched
                        reply.header('cache-control', 'public, max-age=300')
                        return {
                            chainId,
                            query,
                            count: Math.min(tokens.length, limit),
                            stale: false,
                            metadata: {
                                classifications: ['recognized', 'unverified'],
                            },
                            tokens: tokens.slice(0, limit),
                        }
                    }

                    const { catalog, stale } = await service.getCatalog()
                    reply.header(
                        'cache-control',
                        stale || catalog.partial
                            ? 'public, max-age=60'
                            : 'public, max-age=600',
                    )
                    reply.header(
                        'x-token-catalog-cache',
                        stale ? 'STALE' : 'FRESH',
                    )
                    const wrapped = catalog.tokens.find(
                        (token) => token.address === config.market.wrappedNativeAddress,
                    )
                    const tokens = [
                        nativeBnbMarketToken(wrapped?.priceUSD ?? null),
                        ...catalog.tokens.filter(
                            (token) => token.address !== NATIVE_TOKEN_ADDRESS,
                        ),
                    ]
                    return {
                        chainId,
                        query,
                        count: Math.min(tokens.length, limit),
                        stale,
                        generatedAt: new Date(catalog.generatedAt).toISOString(),
                        metadata: {
                            classification: 'established',
                            ...catalog.stats,
                        },
                        tokens: tokens.slice(0, limit),
                    }
                } catch (error) {
                    const safe = getSafeError(error)
                    request.log.warn(
                        { code: safe.body.error.code },
                        'Market token provider request failed',
                    )
                    return reply.code(safe.statusCode).send(safe.body)
                }
            },
        )
    }
}

export const marketCatalogService = createMarketCatalogService()
export const marketTokenRoutes = createMarketTokenRoutes(marketCatalogService)
