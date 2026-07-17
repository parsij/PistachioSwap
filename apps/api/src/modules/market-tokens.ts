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
    searchTokensAcrossChains,
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
import {
    ACTIVE_TOKEN_DISCOVERY_CHAINS,
    getTokenDiscoveryChain,
    requireActiveTokenDiscoveryChain,
} from '../token-discovery/registry.js'

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
    isNative?: boolean
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

type CombinedCatalogCache = {
    generatedAt: number
    tokens: MarketToken[]
    unavailableChainIds: number[]
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

function recognitionFromGeckoTerminal(
    candidates: DiscoveredTokenCandidate[],
) {
    return new Map(
        candidates.flatMap((candidate): Array<[string, CoinGeckoToken]> =>
            candidate.coinGeckoId &&
            candidate.name &&
            candidate.symbol
                ? [[candidate.address, {
                      ...candidate,
                      imageSource: 'coingecko',
                  }]]
                : [],
        ),
    )
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
    chainId: number,
    addresses: string[],
    dependencies: MarketDependencies,
) {
    const chain = requireActiveTokenDiscoveryChain(chainId)
    if ((!chain.capabilities.alchemy && !chain.capabilities.rpcFallback) || addresses.length === 0) {
        return new Map<string, TokenMetadata | null>()
    }
    try {
        return await dependencies.fetchMetadata({ chainId, addresses })
    } catch {
        return new Map<string, TokenMetadata | null>()
    }
}

async function getMissingDecimals(
    chainId: number,
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
        return await dependencies.fetchDecimals({ chainId, addresses })
    } catch {
        return new Map<string, number | null>()
    }
}

async function buildEstablishedTokens({
    chainId,
    candidates,
    recognized,
    markets,
    dependencies,
    now,
}: {
    chainId: number
    candidates: DiscoveredTokenCandidate[]
    recognized: Map<string, CoinGeckoToken>
    markets: Map<string, TokenMarket>
    dependencies: MarketDependencies
    now: number
}) {
    const config = getApiConfig()
    const chain = requireActiveTokenDiscoveryChain(chainId)
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
        chainId,
        recognizedCandidates.map((token) => token.address),
        dependencies,
    )
    const rpcDecimals = await getMissingDecimals(
        chainId,
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
            id: createTokenId(chainId, candidate.address),
            chainId,
            address: candidate.address,
            name: candidate.name!.trim(),
            symbol: candidate.symbol!.trim(),
            decimals,
            ...logo,
            chainLogoURI: chain.chainLogoURI,
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
        (token) => token.address === chain.wrappedNative.address,
    )
    if (wrapped) {
        const nativeLogo = await dependencies.validateLogos(
            getTokenLogoEntries({
                address: NATIVE_TOKEN_ADDRESS,
                localImage: chain.chainLogoURI,
            }),
        )
        if (nativeLogo) {
            tokens.push({
                ...wrapped,
                id: createTokenId(chainId, NATIVE_TOKEN_ADDRESS),
                address: NATIVE_TOKEN_ADDRESS,
                name: chain.native.name,
                symbol: chain.native.symbol,
                decimals: chain.native.decimals,
                ...nativeLogo,
                coinGeckoId: chain.native.coinGeckoId,
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
    chainId,
    candidates,
    markets,
    dependencies,
}: {
    chainId: number
    candidates: TokenCandidate[]
    markets: Map<string, TokenMarket>
    dependencies: MarketDependencies
}) {
    const chain = requireActiveTokenDiscoveryChain(chainId)
    const unique = uniqueCandidates(candidates)
    const metadata = await getOptionalMetadata(
        chainId,
        unique.map((candidate) => candidate.address),
        dependencies,
    )
    const rpcDecimals = await getMissingDecimals(chainId, unique, metadata, dependencies)
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
            id: createTokenId(chainId, candidate.address),
            chainId,
            address: candidate.address,
            name,
            symbol,
            decimals,
            ...logo,
            chainLogoURI: chain.chainLogoURI,
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
    const catalogCaches = new Map<number, CatalogCache>()
    const snapshotLoaded = new Set<number>()
    const refreshPromises = new Map<number, Promise<CatalogCache>>()
    const nextRefreshAllowedAt = new Map<number, number>()
    const searchCache = new Map<string, SearchCache>()
    let combinedCatalog: CombinedCatalogCache | null = null
    let refreshAllPromise: Promise<CombinedCatalogCache> | null = null

    async function loadSnapshotOnce(chainId: number) {
        if (snapshotLoaded.has(chainId)) return
        snapshotLoaded.add(chainId)
        if (chainId !== 56) return
        const snapshot = await resolved.loadSnapshot()
        if (!snapshot) return
        const config = getApiConfig().market
        catalogCaches.set(chainId, {
            ...snapshot,
            expiresAt: snapshot.generatedAt + config.catalogTtlMs,
            staleUntil: snapshot.generatedAt + config.staleTtlMs,
            partial: false,
        })
    }

    async function buildCatalog(chainId: number): Promise<CatalogCache> {
        const config = getApiConfig()
        requireActiveTokenDiscoveryChain(chainId)
        const discovery = asDiscoveryResult(
            await resolved.discoverCandidates({
                chainId,
                minimumCandidates: config.market.candidateLimit,
            }),
        )
        const candidates = uniqueCandidates(discovery.candidates).slice(
            0,
            config.market.candidateLimit,
        ) as DiscoveredTokenCandidate[]
        const [recognitionResult, marketResult] = await Promise.allSettled([
            resolved.fetchRecognized(
                candidates.map((candidate) => candidate.address),
                undefined,
                chainId,
            ),
            resolved.fetchMarkets(
                candidates.map((candidate) => candidate.address),
                undefined,
                chainId,
            ),
        ])
        if (marketResult.status === 'rejected') throw marketResult.reason
        const marketBatch = asMarketResult(marketResult.value)
        const fallbackRecognition =
            recognitionFromGeckoTerminal(candidates)
        if (
            recognitionResult.status === 'rejected' &&
            fallbackRecognition.size === 0
        ) {
            throw recognitionResult.reason
        }
        const recognition = recognitionResult.status === 'fulfilled'
            ? {
                  ...recognitionResult.value,
                  tokens: new Map([
                      ...fallbackRecognition,
                      ...recognitionResult.value.tokens,
                  ]),
              }
            : {
                  tokens: fallbackRecognition,
                  partial: true,
                  successfulBatches: 0,
                  failedBatches: 1,
              }
        const generatedAt = resolved.now()
        const established = await buildEstablishedTokens({
            chainId,
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

    function refreshCatalog(chainId = 56) {
        const existingRefresh = refreshPromises.get(chainId)
        if (existingRefresh) return existingRefresh

        const refreshPromise = buildCatalog(chainId)
            .then(async (catalog) => {
                const existing = catalogCaches.get(chainId)
                if (catalog.partial && existing?.tokens.length) {
                    return existing
                }
                catalogCaches.set(chainId, catalog)
                nextRefreshAllowedAt.set(chainId, 0)
                if (!catalog.partial && chainId === 56) {
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
                refreshPromises.delete(chainId)
            })
        refreshPromises.set(chainId, refreshPromise)
        return refreshPromise
    }

    async function getCatalog(chainId = 56) {
        await loadSnapshotOnce(chainId)
        const now = resolved.now()
        const catalogCache = catalogCaches.get(chainId)
        if (catalogCache && catalogCache.expiresAt > now) {
            return { catalog: catalogCache, stale: false }
        }
        if (catalogCache && catalogCache.staleUntil > now) {
            if (now >= (nextRefreshAllowedAt.get(chainId) ?? 0)) {
                nextRefreshAllowedAt.set(
                    chainId,
                    now + getApiConfig().market.partialRetryMs
                )
                void refreshCatalog(chainId).catch(() => {
                    // Keep the last known catalog during a provider outage.
                })
            }
            return { catalog: catalogCache, stale: true }
        }
        return { catalog: await refreshCatalog(chainId), stale: false }
    }

    async function getExactAddressSearch(chainId: number, address: string) {
        const [tokenResult, marketResult] = await Promise.allSettled([
            resolved.fetchTokenInfo(address, undefined, chainId),
            resolved.searchMarkets(address, undefined, chainId),
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
            chainId,
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

    async function getTextSearch(chainId: number, query: string) {
        let candidates: TokenCandidate[] = []
        let markets = new Map<string, TokenMarket>()
        let coinGeckoError: unknown
        let dexError: unknown

        try {
            candidates = await resolved.searchCandidates(query, undefined, chainId)
        } catch (error) {
            coinGeckoError = error
        }
        if (candidates.length > 0) {
            try {
                markets = asMarketResult(
                    await resolved.fetchMarkets(
                        candidates.map((candidate) => candidate.address),
                        undefined,
                        chainId,
                    ),
                ).markets
            } catch (error) {
                dexError = error
            }
        } else {
            try {
                const fallbackMarkets = await resolved.searchMarkets(query, undefined, chainId)
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
            chainId,
            candidates: candidates.slice(0, 20),
            markets,
            dependencies: resolved,
        })
        return rankBroaderSearch(tokens, query)
    }

    async function getSearch(query: string, chainId = 56) {
        const config = getApiConfig()
        requireActiveTokenDiscoveryChain(chainId)
        const cacheKey = `${chainId}:${query}`
        const cached = searchCache.get(cacheKey)
        if (cached && cached.expiresAt > resolved.now()) return cached.tokens

        const address = normalizeAddress(query)
        const tokens = (
            address
                ? await getExactAddressSearch(chainId, address)
                : await getTextSearch(chainId, query)
        ).slice(0, config.market.searchLimit)
        searchCache.set(cacheKey, {
            tokens,
            expiresAt: resolved.now() + config.market.searchTtlMs,
        })
        return tokens
    }

    function refreshAllCatalogs() {
        if (refreshAllPromise) return refreshAllPromise
        refreshAllPromise = (async () => {
            const results = await boundedMap(
                ACTIVE_TOKEN_DISCOVERY_CHAINS,
                4,
                (chain) => refreshCatalog(chain.chainId),
            )
            const successful = results.flatMap((result) =>
                result.status === 'fulfilled' ? [result.value] : [],
            )
            const unavailableChainIds = results.flatMap((result, index) =>
                result.status === 'rejected'
                    ? [ACTIVE_TOKEN_DISCOVERY_CHAINS[index].chainId]
                    : [],
            )
            if (successful.length === 0) {
                if (combinedCatalog) return combinedCatalog
                const rejected = results.find(
                    (result): result is PromiseRejectedResult =>
                        result.status === 'rejected',
                )
                throw rejected?.reason ?? new Error('No token catalogs are available.')
            }
            const tokens = successful
                .flatMap((catalog) => catalog.tokens.slice(0, 100))
                .filter((token) => token.logoURI && token.volume24hUsd > 0)
                .sort((left, right) =>
                    right.volume24hUsd - left.volume24hUsd ||
                    left.chainId - right.chainId ||
                    left.address.localeCompare(right.address),
                )
                .slice(0, 200)
            combinedCatalog = {
                generatedAt: resolved.now(),
                tokens,
                unavailableChainIds,
            }
            return combinedCatalog as CombinedCatalogCache
        })().finally(() => {
            refreshAllPromise = null
        })
        return refreshAllPromise
    }

    async function getCombinedCatalog() {
        if (combinedCatalog) return combinedCatalog
        return refreshAllCatalogs()
    }

    function startHourlyRefresh(
        intervalMs = 60 * 60 * 1000,
        { refreshImmediately = true } = {},
    ) {
        if (refreshImmediately) {
            void refreshAllCatalogs().catch(() => {
                // Requests retain the last known good combined catalog.
            })
        }
        const timer = setInterval(() => {
            void refreshAllCatalogs().catch(() => {
                // A provider outage must not discard existing catalogs.
            })
        }, intervalMs)
        timer.unref?.()
        return () => clearInterval(timer)
    }

    return {
        getCatalog,
        getCombinedCatalog,
        getSearch,
        refreshAllCatalogs,
        refreshCatalog,
        startHourlyRefresh,
    }
}

type TokenQuery = {
    q?: string
    limit?: string
    chainId?: string
}

function parseLimit(value: string | undefined, maximum: number) {
    if (value === undefined) return maximum
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum
        ? parsed
        : null
}

function sendUnsupportedChain(reply: FastifyReply) {
    return reply.code(400).send({
        error: {
            code: 'UNSUPPORTED_CHAIN',
            message: 'The requested chain is not enabled for token discovery.',
        },
    })
}

function nativeMarketToken(chainId: number, priceUSD: string | null): MarketToken {
    const chain = requireActiveTokenDiscoveryChain(chainId)
    return {
        id: createTokenId(chainId, NATIVE_TOKEN_ADDRESS),
        chainId,
        address: NATIVE_TOKEN_ADDRESS,
        name: chain.native.name,
        symbol: chain.native.symbol,
        decimals: chain.native.decimals,
        logoURI: chain.chainLogoURI,
        logoCandidates: [chain.chainLogoURI],
        logoSource: 'local',
        chainLogoURI: chain.chainLogoURI,
        coinGeckoId: chain.native.coinGeckoId,
        priceUSD,
        volume24hUsd: 0,
        liquidityUsd: 0,
        pairCount: 0,
        oldestPairCreatedAt: null,
        marketUrl: null,
        rank: 1,
        verificationStatus: 'established',
        verificationReasons: ['explicit-native-allowlist'],
        isNative: true,
    }
}

async function boundedMap<T, R>(
    values: readonly T[],
    concurrency: number,
    run: (value: T) => Promise<R>,
) {
    const output: PromiseSettledResult<R>[] = new Array(values.length)
    let cursor = 0
    await Promise.all(Array.from(
        { length: Math.min(concurrency, values.length) },
        async () => {
            while (cursor < values.length) {
                const index = cursor++
                try {
                    output[index] = { status: 'fulfilled', value: await run(values[index]) }
                } catch (reason) {
                    output[index] = { status: 'rejected', reason }
                }
            }
        },
    ))
    return output
}

export function createMarketTokenRoutes(
    service = createMarketCatalogService(),
    searchAcrossChains = searchTokensAcrossChains,
): FastifyPluginAsync {
    return async (app) => {
        app.get<{ Querystring: TokenQuery }>(
            '/v1/market-tokens',
            {
                schema: {
                    querystring: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {
                            chainId: {
                                type: 'string',
                                pattern: '^(?:all|[1-9][0-9]*)$',
                            },
                            q: { type: 'string', maxLength: 80 },
                            limit: {
                                type: 'string',
                                pattern: '^[1-9][0-9]*$',
                            },
                        },
                    },
                },
                config: {
                    rateLimit: { max: 30, timeWindow: '1 minute' },
                },
            },
            async (request, reply) => {
                const config = getApiConfig()
                const unsupportedParameters = Object.keys(request.query)
                    .filter((key) => !['chainId', 'q', 'limit'].includes(key))
                if (unsupportedParameters.length > 0) {
                    return reply.code(400).send({
                        error: {
                            code: 'UNSUPPORTED_QUERY_PARAMETER',
                            message: 'Unsupported query parameter.',
                        },
                    })
                }
                const rawChainId = request.query.chainId ?? String(config.chainId)
                const allChains = rawChainId === 'all'
                if (!allChains && !/^[1-9]\d*$/.test(rawChainId)) {
                    return sendUnsupportedChain(reply)
                }
                const chainId = allChains ? null : Number(rawChainId)
                if (chainId !== null && !getTokenDiscoveryChain(chainId)?.active) {
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

                const maximum = allChains && !query
                    ? 200
                    : query
                        ? config.market.searchLimit
                        : config.market.defaultLimit
                const limit = parseLimit(request.query.limit, maximum)
                if (limit === null) {
                    return reply.code(400).send({
                        error: {
                            code: 'INVALID_LIMIT',
                            message: `Limit must be an integer between 1 and ${maximum}.`,
                        },
                    })
                }

                const controller = new AbortController()
                const abort = () => controller.abort()
                request.raw.once('aborted', abort)
                try {
                    if (allChains) {
                        if (!query) {
                            const combined = await service.getCombinedCatalog()
                            const tokens = combined.tokens.slice(0, limit)
                            reply.header('cache-control', 'public, max-age=300')
                            return {
                                chainId: 'all',
                                query,
                                count: tokens.length,
                                stale: false,
                                partial: combined.unavailableChainIds.length > 0,
                                generatedAt: new Date(
                                    combined.generatedAt,
                                ).toISOString(),
                                metadata: {
                                    searchedChains:
                                        ACTIVE_TOKEN_DISCOVERY_CHAINS.length,
                                    unavailableChainIds:
                                        combined.unavailableChainIds,
                                    perChainLimit: 100,
                                    combinedLimit: 200,
                                },
                                tokens,
                            }
                        }
                        const targetChains = query
                            ? [
                                  ...new Set(
                                      (
                                          await searchAcrossChains(
                                              query,
                                              controller.signal,
                                          )
                                      ).map(({ chainId }) => chainId),
                                  ),
                              ].flatMap((chainId) => {
                                  const chain = getTokenDiscoveryChain(chainId)
                                  return chain?.active ? [chain] : []
                              })
                            : []
                        const results = await boundedMap(
                            targetChains,
                            4,
                            async (chain) => {
                                if (query) {
                                    return {
                                        chainId: chain.chainId,
                                        stale: false,
                                        tokens: (await service.getSearch(query, chain.chainId))
                                            .slice(0, 8),
                                    }
                                }
                                const result = await service.getCatalog(chain.chainId)
                                return {
                                    chainId: chain.chainId,
                                    stale: result.stale,
                                    tokens: result.catalog.tokens
                                        .filter((token) => token.logoURI && token.volume24hUsd > 0)
                                        .slice(0, 3),
                                }
                            },
                        )
                        const groups = results.flatMap((result, index) =>
                            result.status === 'fulfilled'
                                ? [result.value]
                                : [{
                                      chainId: targetChains[index].chainId,
                                      stale: false,
                                      tokens: [] as MarketToken[],
                                  }],
                        )
                        const tokens = groups
                            .flatMap((group) => group.tokens)
                            .sort((left, right) =>
                                query
                                    ? (left.rank ?? 999) - (right.rank ?? 999)
                                    : right.volume24hUsd - left.volume24hUsd,
                            )
                            .slice(0, limit)
                        const unavailableChainIds = results.flatMap((result, index) =>
                            result.status === 'rejected'
                                ? [targetChains[index].chainId]
                                : [],
                        )
                        reply.header('cache-control', 'public, max-age=60')
                        return {
                            chainId: 'all',
                            query,
                            count: tokens.length,
                            stale: groups.some((group) => group.stale),
                            partial: unavailableChainIds.length > 0,
                            metadata: {
                                searchedChains: targetChains.length,
                                unavailableChainIds,
                                perChainLimit: query ? 8 : 3,
                            },
                            tokens,
                        }
                    }

                    const selectedChainId = chainId!
                    const selectedChain = requireActiveTokenDiscoveryChain(selectedChainId)
                    if (query) {
                        const nativeQuery =
                            query === NATIVE_TOKEN_ADDRESS ||
                            [
                                selectedChain.native.symbol.toLowerCase(),
                                selectedChain.native.name.toLowerCase(),
                                `native ${selectedChain.native.symbol.toLowerCase()}`,
                            ].includes(query)
                        const searched = nativeQuery && query === NATIVE_TOKEN_ADDRESS
                            ? []
                            : await service.getSearch(query, selectedChainId)
                        const wrapped = searched.find(
                            (token) => token.address === selectedChain.wrappedNative.address,
                        )
                        const tokens = nativeQuery
                            ? [
                                  nativeMarketToken(selectedChainId, wrapped?.priceUSD ?? null),
                                  ...searched.filter(
                                      (token) => token.address !== NATIVE_TOKEN_ADDRESS,
                                  ),
                              ]
                            : searched
                        reply.header('cache-control', 'public, max-age=300')
                        return {
                            chainId: selectedChainId,
                            query,
                            count: Math.min(tokens.length, limit),
                            stale: false,
                            metadata: {
                                classifications: ['recognized', 'unverified'],
                            },
                            tokens: tokens.slice(0, limit),
                        }
                    }

                    const { catalog, stale } = await service.getCatalog(selectedChainId)
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
                        (token) => token.address === selectedChain.wrappedNative.address,
                    )
                    const tokens = [
                        nativeMarketToken(selectedChainId, wrapped?.priceUSD ?? null),
                        ...catalog.tokens.filter(
                            (token) => token.address !== NATIVE_TOKEN_ADDRESS,
                        ),
                    ]
                    return {
                        chainId: selectedChainId,
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
                } finally {
                    request.raw.off('aborted', abort)
                }
            },
        )
    }
}

export const marketCatalogService = createMarketCatalogService()
export const marketTokenRoutes = createMarketTokenRoutes(marketCatalogService)
