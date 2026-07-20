import { createHash } from 'node:crypto'
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
import { setBoundedCacheEntry } from '../lib/bounded-cache.js'
import {
    type MarketCatalogPersistence,
    type PersistedMarketCatalog,
    postgresMarketCatalogPersistence,
} from '../market-catalog/persistence.js'
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
import {
    fetchDexPaprikaMarketTokens,
} from '../providers/dexpaprika/market-tokens.js'
import { getDexPaprikaNetworkId } from '../providers/dexpaprika/networks.js'
import {
    getOfficialAsset,
    getOfficialAssetsForChain,
    type OfficialAsset,
} from '../providers/recognition/curated-token-lists.js'
import { getTokenDecimalsBatch } from '../providers/token-decimals.js'
import {
    type LogoSource,
    buildTokenLogo,
    getTokenLogoEntries,
    getTrustedNativeAssetImage,
} from '../providers/token-logos.js'
import {
    ACTIVE_TOKEN_DISCOVERY_CHAINS,
    canonicalTokenAddress,
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
    canonicalId?: string
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
    marketPriceUSD?: string | null
    priceChange24hPercent?: number | null
    volume24hUsd: number | null
    volume7dUsd?: number | null
    volume30dUsd?: number | null
    liquidityUsd: number | null
    fdvUsd?: number | null
    transactions24h?: number | null
    poolsCount?: number | null
    createdAt?: string | null
    hasProviderImage?: boolean
    pairCount: number | null
    oldestPairCreatedAt: string | null
    marketUrl: string | null
    rank: number | null
    verificationStatus: VerificationStatus
    verificationReasons: string[]
    recognitionReasons?: string[]
    possibleSpam?: boolean | null
    visibility?: 'primary' | 'unverified' | 'hidden'
    securityStatus?: 'trusted' | 'low' | 'caution' | 'high' | 'blocked' | 'unknown'
    isNative?: boolean
    recognitionStatus?: VerificationStatus
    verifiedContract?: boolean
    officialAsset?: boolean
    spamStatus?: 'clean' | 'possible-spam'
    marketSource?: MarketCatalogProvider | 'curated' | 'fallback'
    source?: 'curated' | 'provider'
    catalogSection?: 'common' | 'volume'
}

export type MarketCatalogProvider =
    | 'dexpaprika'
    | 'geckoterminal'
    | 'coingecko'
    | 'dexscreener'

export type MarketProviderFailure = {
    provider: MarketCatalogProvider
    code: string
    operation: string
    upstreamStatus: number | null
    retryAfterMs: number
}

export type MarketProviderMetadata = {
    availableProviders: MarketCatalogProvider[]
    unavailableProviders: MarketProviderFailure[]
}

export type CatalogStats = {
    candidatesInspected: number
    recognizedCandidates: number
    establishedTokens: number
    pagesCompleted: number
    providerPartial: boolean
    providerFailures: {
        dexPaprika: boolean
        geckoTerminalPagination: boolean
        coinGeckoFailedBatches: number
        dexScreenerFailedBatches: number
    }
    exclusionReasons: Record<string, number>
}

export type CatalogPersistenceMetadata = {
    source: 'memory' | 'database' | 'curated'
    lastAttemptedAt: number | null
    lastSuccessAt: number | null
    nextRefreshAt: number | null
    contentHash: string | null
}

type CatalogCache = {
    generatedAt: number
    expiresAt: number
    staleUntil: number
    partial: boolean
    catalogUnavailable: boolean
    tokens: MarketToken[]
    commonTokens?: MarketToken[]
    stats: CatalogStats
    providerMetadata: MarketProviderMetadata
    persistence: CatalogPersistenceMetadata
}

type SearchCache = {
    expiresAt: number
    tokens: MarketToken[]
}

type CombinedCatalogCache = {
    generatedAt: number
    tokens: MarketToken[]
    chains: Record<string, {
        count: number
        commonCount: number
        stale: boolean
        partial: boolean
        providerStatus: MarketProviderMetadata
        exclusionCounts: Record<string, number>
    }>
    unavailableChainIds: number[]
    staleChainIds: number[]
    partialChainIds: number[]
    partial: boolean
    stale: boolean
    hardStale: boolean
    persistence: CatalogPersistenceMetadata
}

type Snapshot = Pick<CatalogCache, 'generatedAt' | 'tokens' | 'stats'> & {
    schemaVersion: number
}

export type MarketDependencies = {
    discoverDexPaprika: typeof fetchDexPaprikaMarketTokens
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
    persistence: MarketCatalogPersistence
    now: () => number
}

const SNAPSHOT_PATH = fileURLToPath(
    new URL('../../data/bsc-established-top-tokens.json', import.meta.url),
)
export const MARKET_CATALOG_SCHEMA_VERSION = 5
export const MARKET_PROVIDER_BACKOFF_INITIAL_MS = 60_000
export const MARKET_PROVIDER_BACKOFF_MAX_MS = 15 * 60_000
export const MARKET_CATALOG_ROLLING_REFRESH_MS = 60_000
export const MARKET_CATALOG_REFRESH_JITTER_MAX_MS = 10_000

function emptyPersistence(
    source: CatalogPersistenceMetadata['source'],
): CatalogPersistenceMetadata {
    return {
        source,
        lastAttemptedAt: null,
        lastSuccessAt: null,
        nextRefreshAt: null,
        contentHash: null,
    }
}

function dateMilliseconds(value: Date | null) {
    const milliseconds = value?.getTime() ?? Number.NaN
    return Number.isFinite(milliseconds) ? milliseconds : null
}

function minimumTimestamp(values: Array<number | null>) {
    const timestamps = values.filter((value): value is number => value !== null)
    return timestamps.length > 0 ? Math.min(...timestamps) : null
}

export function marketCatalogContentHash(
    tokens: readonly MarketToken[],
    commonTokens: readonly MarketToken[],
) {
    return createHash('sha256')
        .update(JSON.stringify({
            schemaVersion: MARKET_CATALOG_SCHEMA_VERSION,
            tokens,
            commonTokens,
        }))
        .digest('hex')
}

export function isPartialCatalogDemonstrablyBetter({
    existingRankedCount,
    nextRankedCount,
    existingProviderCount,
    nextProviderCount,
}: {
    existingRankedCount: number
    nextRankedCount: number
    existingProviderCount: number
    nextProviderCount: number
}) {
    return nextRankedCount > existingRankedCount ||
        (nextRankedCount === existingRankedCount &&
            nextProviderCount > existingProviderCount)
}

function safeProviderFailure(error: unknown) {
    if (error instanceof ProviderError) {
        return {
            code: error.code,
            upstreamStatus: error.upstreamStatus,
            retryable: error.retryable || [
                'rate-limit',
                'timeout',
                'upstream',
            ].includes(error.outcome),
            retryAfterMs: error.retryAfterMs,
        }
    }
    return {
        code: 'PROVIDER_UNAVAILABLE',
        upstreamStatus: null,
        retryable: true,
        retryAfterMs: 0,
    }
}

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
            schemaVersion?: unknown
            tokens?: unknown
            stats?: unknown
        }
        if (
            parsed.schemaVersion !== MARKET_CATALOG_SCHEMA_VERSION ||
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
            const volume =
                (right.volume24hUsd ?? -1) - (left.volume24hUsd ?? -1)
            if (volume !== 0) return volume
            const liquidity =
                (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1)
            if (liquidity !== 0) return liquidity
            const chain = left.chainId - right.chainId
            if (chain !== 0) return chain
            return left.address.localeCompare(right.address)
        })
        .map((token, index) => ({ ...token, rank: index + 1 }))
}

export function filterEligibleVolumeTokens(tokens: readonly MarketToken[]) {
    const config = getApiConfig()
    const minimumLiquidityUsd = config.dexPaprika.minimumLiquidityUsd
    const exclusionReasons: Record<string, number> = {}
    const eligible = new Map<string, MarketToken>()
    const exclude = (reason: string) => {
        exclusionReasons[reason] = (exclusionReasons[reason] ?? 0) + 1
    }
    for (const token of tokens) {
        const chain = getTokenDiscoveryChain(Number(token.chainId))
        const normalized = normalizeAddress(token.address)
        if (!chain?.active || !normalized) {
            exclude('invalidIdentity')
            continue
        }
        const canonicalAddress = canonicalTokenAddress(token.chainId, normalized)
        const native = canonicalAddress === NATIVE_TOKEN_ADDRESS
        if (!['established', 'recognized'].includes(token.verificationStatus)) {
            exclude('unverified')
            continue
        }
        if (token.possibleSpam === true) {
            exclude('possibleSpam')
            continue
        }
        if (token.visibility === 'hidden') {
            exclude('hidden')
            continue
        }
        if (token.securityStatus === 'high' || token.securityStatus === 'blocked') {
            exclude('securityBlocked')
            continue
        }
        const reasons = token.verificationReasons ?? []
        const trustedIdentity = native
            ? reasons.includes('explicit-native-allowlist')
            : reasons.some((reason) => [
                  'coingecko-exact-contract',
                  'curated-official-contract',
                  'curated-token-allowlist',
                  'trusted-asset-exact-contract',
                  'provider-verified-contract',
              ].includes(reason))
        if (!trustedIdentity) {
            exclude('missingTrustedContractMatch')
            continue
        }
        if (!normalizedText(token.name, 120) || !normalizedText(token.symbol, 32) ||
            !validDecimals(token.decimals)) {
            exclude('invalidMetadata')
            continue
        }
        if (!Number.isFinite(token.volume24hUsd) || Number(token.volume24hUsd) <= 0) {
            exclude('missingVolume')
            continue
        }
        if (!Number.isFinite(token.liquidityUsd) ||
            Number(token.liquidityUsd) < minimumLiquidityUsd) {
            exclude('insufficientLiquidity')
            continue
        }
        if (!Number.isFinite(token.transactions24h) ||
            Number(token.transactions24h) < config.dexPaprika.minimumTransactions24h) {
            exclude('insufficientTransactions')
            continue
        }
        const identity = createTokenId(token.chainId, canonicalAddress)
        const existing = eligible.get(identity)
        const candidate = native ? {
            ...token,
            address: NATIVE_TOKEN_ADDRESS,
            name: chain.native.name,
            symbol: chain.native.symbol,
            isNative: true,
        } : token
        if (!existing || normalized === NATIVE_TOKEN_ADDRESS) eligible.set(identity, candidate)
    }
    return { tokens: rankTokens([...eligible.values()]), exclusionReasons }
}

function isCuratedCommonToken(token: MarketToken) {
    return token.source === 'curated' &&
        token.catalogSection === 'common' &&
        token.verifiedContract === true &&
        ['established', 'recognized'].includes(token.verificationStatus) &&
        token.visibility !== 'hidden' &&
        token.possibleSpam !== true &&
        token.securityStatus !== 'high' &&
        token.securityStatus !== 'blocked' &&
        normalizeAddress(token.address) !== null &&
        Boolean(normalizedText(token.name, 120)) &&
        Boolean(normalizedText(token.symbol, 32)) &&
        validDecimals(token.decimals)
}

function composePublicCatalogTokens(tokens: readonly MarketToken[]) {
    const volumeTokens = filterEligibleVolumeTokens(tokens).tokens.map((token) =>
        normalizePublicMarketToken(token, 'volume'))
    const volumeIds = new Set(volumeTokens.map((token) => token.id))
    const commonTokens = [...new Map(tokens
        .filter(isCuratedCommonToken)
        .filter((token) => !volumeIds.has(token.id))
        .map((token) => [
            createTokenId(
                token.chainId,
                canonicalTokenAddress(token.chainId, token.address),
            ),
            token,
        ])).values()]
        .sort((left, right) =>
            left.chainId - right.chainId ||
            left.symbol.localeCompare(right.symbol) ||
            left.address.localeCompare(right.address),
        )
        .map((token) => normalizePublicMarketToken({ ...token, rank: null }, 'common'))
    return { tokens: volumeTokens, commonTokens }
}

const TRUSTED_CONTRACT_REASONS = new Set([
    'coingecko-exact-contract', 'curated-official-contract',
    'curated-token-allowlist', 'trusted-asset-exact-contract',
    'provider-verified-contract', 'explicit-native-allowlist',
])

export function normalizePublicMarketToken(
    token: MarketToken,
    catalogSection: 'common' | 'volume',
): MarketToken {
    const canonicalAddress = canonicalTokenAddress(token.chainId, token.address)
    const canonicalId = createTokenId(token.chainId, canonicalAddress)
    const recognitionReasons = [...new Set(token.verificationReasons ?? [])]
    const verifiedContract = recognitionReasons.some((reason) =>
        TRUSTED_CONTRACT_REASONS.has(reason))
    const officialAsset = canonicalAddress === NATIVE_TOKEN_ADDRESS ||
        getOfficialAsset(token.chainId, canonicalAddress) !== null ||
        token.source === 'curated'
    const logoCandidates = [...new Set([
        ...(token.logoCandidates ?? []), token.logoURI,
        '/icons/token-fallback.svg',
    ].filter((value): value is string => typeof value === 'string' && value.length > 0))]
    const recognitionStatus = token.recognitionStatus ?? token.verificationStatus
    return {
        ...token,
        id: canonicalId,
        canonicalId,
        address: canonicalAddress,
        catalogSection,
        recognitionStatus,
        recognitionReasons,
        verificationStatus: recognitionStatus,
        verificationReasons: recognitionReasons,
        verifiedContract,
        officialAsset,
        possibleSpam: false,
        spamStatus: 'clean',
        securityStatus: token.securityStatus ?? 'unknown',
        visibility: 'primary',
        logoURI: logoCandidates[0] ?? '/icons/token-fallback.svg',
        logoCandidates,
        logoSource: token.logoSource ?? 'fallback',
        marketSource: token.hasProviderImage !== undefined
            ? 'dexpaprika'
            : token.marketSource ?? (catalogSection === 'common' ? 'curated' : 'dexscreener'),
    }
}

function isCompatiblePersistedToken(
    value: unknown,
    chainId: number,
    section: 'common' | 'volume',
): value is MarketToken {
    if (typeof value !== 'object' || value === null) return false
    const token = value as Partial<MarketToken>
    const address = normalizeAddress(token.address)
    const reasons = Array.isArray(token.recognitionReasons)
        ? token.recognitionReasons
        : []
    const trustedContract = reasons.some((reason) =>
        typeof reason === 'string' && TRUSTED_CONTRACT_REASONS.has(reason))
    const baseValid = token.chainId === chainId && address !== null &&
        canonicalTokenAddress(chainId, address) === token.address &&
        token.canonicalId === createTokenId(chainId, token.address) &&
        token.catalogSection === section &&
        ['recognized', 'established'].includes(String(token.recognitionStatus)) &&
        token.verifiedContract === true && trustedContract &&
        token.possibleSpam === false && token.spamStatus === 'clean' &&
        token.visibility === 'primary' &&
        token.securityStatus !== 'high' && token.securityStatus !== 'blocked' &&
        Boolean(normalizedText(token.name, 120)) &&
        Boolean(normalizedText(token.symbol, 32)) && validDecimals(token.decimals) &&
        typeof token.logoURI === 'string' && token.logoURI.length > 0 &&
        Array.isArray(token.logoCandidates) && token.logoCandidates.length > 0 &&
        token.logoCandidates.every((candidate) =>
            typeof candidate === 'string' && candidate.length > 0)
    if (!baseValid) return false
    if (section === 'common') return true
    return Number.isFinite(token.volume24hUsd) && Number(token.volume24hUsd) > 0 &&
        Number.isFinite(token.liquidityUsd) && Number(token.liquidityUsd) > 0 &&
        Number.isFinite(token.transactions24h) && Number(token.transactions24h) > 0
}

function safeProviderMetadata(value: unknown): MarketProviderMetadata {
    if (typeof value !== 'object' || value === null) {
        return { availableProviders: [], unavailableProviders: [] }
    }
    const metadata = value as Partial<MarketProviderMetadata>
    return {
        availableProviders: Array.isArray(metadata.availableProviders)
            ? metadata.availableProviders.filter((provider): provider is MarketCatalogProvider =>
                ['dexpaprika', 'geckoterminal', 'coingecko', 'dexscreener'].includes(
                    String(provider),
                ))
            : [],
        unavailableProviders: Array.isArray(metadata.unavailableProviders)
            ? metadata.unavailableProviders.filter((failure): failure is MarketProviderFailure =>
                typeof failure === 'object' && failure !== null &&
                typeof failure.code === 'string' &&
                typeof failure.operation === 'string' &&
                ['dexpaprika', 'geckoterminal', 'coingecko', 'dexscreener'].includes(
                    String(failure.provider),
                ))
            : [],
    }
}

function safeExclusionCounts(value: unknown) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).flatMap(([key, count]) =>
        Number.isSafeInteger(count) && Number(count) >= 0
            ? [[key, Number(count)]]
            : [],
    ))
}

function compatiblePersistedCatalog(
    row: PersistedMarketCatalog,
): row is PersistedMarketCatalog & {
    rankedTokens: MarketToken[]
    commonTokens: MarketToken[]
} {
    return row.schemaVersion === MARKET_CATALOG_SCHEMA_VERSION &&
        Boolean(getTokenDiscoveryChain(row.chainId)?.active) &&
        row.rankedTokens.length > 0 && row.rankedTokens.length <= 100 &&
        row.rankedTokens.every((token) =>
            isCompatiblePersistedToken(token, row.chainId, 'volume')) &&
        row.commonTokens.every((token) =>
            isCompatiblePersistedToken(token, row.chainId, 'common'))
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
    candidates: TokenCandidate[]
    recognized: Map<string, CoinGeckoToken>
    markets: Map<string, TokenMarket>
    dependencies: MarketDependencies
    now: number
}) {
    const config = getApiConfig()
    const chain = requireActiveTokenDiscoveryChain(chainId)
    const exclusions: Record<string, number> = {}
    const recognizedCandidates: Array<{
        candidate: CoinGeckoToken
        officialAsset: OfficialAsset | null
    }> = []
    const optionalFallbackAddresses = new Set<string>()

    for (const discovered of uniqueCandidates(candidates)) {
        const token = recognized.get(discovered.address)
        const officialAsset = getOfficialAsset(chainId, discovered.address)
        const reasons: string[] = []
        if (config.market.blocklist.has(discovered.address)) {
            reasons.push('manually-blocklisted')
        }
        if (!officialAsset && !isRecognizedToken(discovered.address, token)) {
            reasons.push('coin-not-listed')
        }
        if (reasons.length > 0) {
            incrementReasons(exclusions, reasons)
        } else if (officialAsset || token) {
            recognizedCandidates.push({
                officialAsset,
                candidate: officialAsset ? {
                    address: officialAsset.address,
                    name: officialAsset.name,
                    symbol: officialAsset.symbol,
                    decimals: officialAsset.decimals,
                    imageUrl: token?.imageUrl ?? null,
                    coinGeckoId: officialAsset.coinGeckoId,
                    priceUSD: token?.priceUSD ?? null,
                    imageSource: 'coingecko',
                } : token!,
            })
        }
    }

    const metadata = await getOptionalMetadata(
        chainId,
        recognizedCandidates.map(({ candidate }) => candidate.address),
        dependencies,
    )
    const rpcDecimals = await getMissingDecimals(
        chainId,
        recognizedCandidates.map(({ candidate }) => candidate),
        metadata,
        dependencies,
    )
    const evaluated: Array<MarketToken | null> = await Promise.all(recognizedCandidates.map(async ({ candidate, officialAsset }): Promise<MarketToken | null> => {
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
            optionalFallbackAddresses.add(candidate.address)
            return null
        }

        let logo = null
        try {
            logo = await dependencies.validateLogos(
                getTokenLogoEntries({
                    chainId,
                    address: candidate.address,
                    curatedImages: officialAsset?.logoCandidates,
                    coinGeckoImage: candidate.imageUrl,
                    alchemyImage: tokenMetadata?.logoURI,
                }),
            )
        } catch {
            // Logo validation is optional catalog enrichment.
        }
        if (!logo) {
            incrementReasons(exclusions, ['logo-unavailable'])
            optionalFallbackAddresses.add(candidate.address)
            return null
        }

        return {
            id: createTokenId(chainId, candidate.address),
            chainId,
            address: candidate.address,
            name: officialAsset?.name ?? candidate.name!.trim(),
            symbol: officialAsset?.symbol ?? candidate.symbol!.trim(),
            decimals,
            ...logo,
            chainLogoURI: chain.chainLogoURI,
            coinGeckoId: officialAsset?.coinGeckoId ?? candidate.coinGeckoId!.trim(),
            priceUSD: market?.priceUSD ?? candidate.priceUSD,
            volume24hUsd: market?.volume24hUsd ?? null,
            liquidityUsd: market?.liquidityUsd ?? null,
            pairCount: market?.pairCount ?? null,
            oldestPairCreatedAt: market?.oldestPairCreatedAt ?? null,
            marketUrl: market?.pairUrl ?? null,
            rank: null,
            verificationStatus: 'established',
            verificationReasons: [
                officialAsset
                    ? 'curated-official-contract'
                    : 'coingecko-exact-contract',
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
        let nativeLogo = null
        try {
            nativeLogo = await dependencies.validateLogos(
                getTokenLogoEntries({
                    chainId,
                    address: NATIVE_TOKEN_ADDRESS,
                    localImage: chain.chainLogoURI,
                }),
            )
        } catch {
            // A missing native logo must not discard ERC-20 catalog entries.
        }
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
        optionalFallbackAddresses,
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
        const officialAsset = getOfficialAsset(chainId, candidate.address)
        const name =
            officialAsset?.name ?? normalizedText(candidate.name, 120) ??
            normalizedText(tokenMetadata?.name, 120) ??
            normalizedText(market?.name, 120)
        const symbol =
            officialAsset?.symbol ?? normalizedText(candidate.symbol, 32) ??
            normalizedText(tokenMetadata?.symbol, 32) ??
            normalizedText(market?.symbol, 32)
        const decimals = validDecimals(officialAsset?.decimals)
            ? officialAsset.decimals
            : validDecimals(candidate.decimals)
            ? candidate.decimals
            : validDecimals(tokenMetadata?.decimals)
              ? tokenMetadata.decimals
              : rpcDecimals.get(candidate.address)
        if (!name || !symbol || !validDecimals(decimals)) continue

        const recognized = officialAsset !== null || isRecognizedToken(
            candidate.address,
            candidate.imageSource === 'coingecko' ? candidate : undefined,
        )
        const logo = buildTokenLogo({
            chainId,
            address: candidate.address,
            curatedImages: officialAsset?.logoCandidates,
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
            coinGeckoId: officialAsset?.coinGeckoId ??
                (recognized ? candidate.coinGeckoId : null),
            priceUSD: market?.priceUSD ?? candidate.priceUSD,
            volume24hUsd: market?.volume24hUsd ?? null,
            liquidityUsd: market?.liquidityUsd ?? null,
            pairCount: market?.pairCount ?? null,
            oldestPairCreatedAt: market?.oldestPairCreatedAt ?? null,
            marketUrl: market?.pairUrl ?? null,
            rank: null,
            verificationStatus: officialAsset ? 'established' :
                recognized ? 'recognized' : 'unverified',
            verificationReasons: officialAsset
                ? [
                      'curated-official-contract',
                      ...marketReasons(market, dependencies.now()).reasons,
                      ...marketReasons(market, dependencies.now()).failures,
                  ]
                : verificationReasonsForSearch(
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
        (token) => ['established', 'recognized'].includes(token.verificationStatus),
    )
    const unverified = tokens.filter(
        (token) => !['established', 'recognized'].includes(token.verificationStatus),
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
    const useProviderRefreshJitter = dependencies.discoverCandidates === undefined
    const resolved: MarketDependencies = {
        discoverCandidates: discoverTopPoolTokens,
        discoverDexPaprika: fetchDexPaprikaMarketTokens,
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
        persistence: postgresMarketCatalogPersistence,
        now: Date.now,
        ...dependencies,
    }
    const catalogCaches = new Map<number, CatalogCache>()
    const snapshotLoaded = new Set<number>()
    const refreshPromises = new Map<number, Promise<CatalogCache>>()
    const nextRefreshAllowedAt = new Map<number, number>()
    const providerBackoff = new Map<string, {
        failures: number
        nextAttemptAt: number
        code: string
    }>()
    const searchCache = new Map<string, SearchCache>()
    const lastAttemptedAt = new Map<number, number>()
    const lastSuccessAt = new Map<number, number>()
    const nextScheduledRefreshAt = new Map<number, number>()
    let combinedCatalog: CombinedCatalogCache | null = null
    let refreshAllPromise: Promise<CombinedCatalogCache> | null = null
    let schedulerTimer: ReturnType<typeof setTimeout> | null = null
    let schedulerStop: (() => void) | null = null
    let schedulerTickInFlight = false
    let persistenceWarningHandler: ((code: string) => void) | null = null

    function reportPersistenceWarning(code: string) {
        persistenceWarningHandler?.(code)
    }

    async function recordPersistenceAttempt(
        chainId: number,
        providerStatus?: MarketProviderMetadata,
    ) {
        const attemptedAt = resolved.now()
        const nextRefreshAt = attemptedAt +
            ACTIVE_TOKEN_DISCOVERY_CHAINS.length * MARKET_CATALOG_ROLLING_REFRESH_MS
        lastAttemptedAt.set(chainId, attemptedAt)
        nextScheduledRefreshAt.set(chainId, nextRefreshAt)
        const cached = catalogCaches.get(chainId)
        if (cached) {
            cached.persistence = {
                ...cached.persistence,
                lastAttemptedAt: attemptedAt,
                nextRefreshAt,
            }
        }
        await resolved.persistence.recordAttempt({
            chainId,
            schemaVersion: MARKET_CATALOG_SCHEMA_VERSION,
            ...(providerStatus === undefined ? {} : { providerStatus }),
            lastAttemptedAt: new Date(attemptedAt),
            nextRefreshAt: new Date(nextRefreshAt),
        }).catch(() => reportPersistenceWarning('MARKET_CATALOG_ATTEMPT_WRITE_FAILED'))
        return { attemptedAt, nextRefreshAt }
    }

    async function hydratePersistentCatalogs() {
        let rows: PersistedMarketCatalog[]
        try {
            rows = await resolved.persistence.loadAll()
        } catch {
            reportPersistenceWarning('MARKET_CATALOG_HYDRATION_FAILED')
            return { loaded: 0, ignored: 0, degraded: true }
        }
        let loaded = 0
        let ignored = 0
        const config = getApiConfig()
        const cacheTtlMs = Math.min(
            config.market.catalogTtlMs,
            config.dexPaprika.cacheTtlMs,
        )
        const staleTtlMs = Math.min(
            config.market.staleTtlMs,
            config.dexPaprika.staleTtlMs,
        )
        for (const row of rows) {
            const currentSchema = row.schemaVersion === MARKET_CATALOG_SCHEMA_VERSION
            const activeChain = Boolean(getTokenDiscoveryChain(row.chainId)?.active)
            if (currentSchema && activeChain) {
                const attemptedAt = dateMilliseconds(row.lastAttemptedAt)
                const nextRefreshAt = dateMilliseconds(row.nextRefreshAt)
                if (attemptedAt !== null) lastAttemptedAt.set(row.chainId, attemptedAt)
                if (nextRefreshAt !== null) {
                    nextScheduledRefreshAt.set(row.chainId, nextRefreshAt)
                }
            }
            if (!compatiblePersistedCatalog(row)) {
                ignored += 1
                continue
            }
            const generatedAt = dateMilliseconds(row.generatedAt) ??
                dateMilliseconds(row.lastSuccessAt) ?? resolved.now()
            const attemptedAt = dateMilliseconds(row.lastAttemptedAt)
            const succeededAt = dateMilliseconds(row.lastSuccessAt) ?? generatedAt
            const nextRefreshAt = dateMilliseconds(row.nextRefreshAt)
            if (attemptedAt !== null) lastAttemptedAt.set(row.chainId, attemptedAt)
            lastSuccessAt.set(row.chainId, succeededAt)
            if (nextRefreshAt !== null) {
                nextScheduledRefreshAt.set(row.chainId, nextRefreshAt)
            }
            catalogCaches.set(row.chainId, {
                generatedAt,
                expiresAt: generatedAt + cacheTtlMs,
                staleUntil: generatedAt + staleTtlMs,
                partial: row.partial,
                catalogUnavailable: false,
                tokens: row.rankedTokens,
                commonTokens: row.commonTokens,
                stats: {
                    candidatesInspected: row.rankedTokens.length,
                    recognizedCandidates: row.rankedTokens.length,
                    establishedTokens: row.rankedTokens.length,
                    pagesCompleted: 0,
                    providerPartial: row.partial,
                    providerFailures: {
                        dexPaprika: false,
                        geckoTerminalPagination: false,
                        coinGeckoFailedBatches: 0,
                        dexScreenerFailedBatches: 0,
                    },
                    exclusionReasons: safeExclusionCounts(row.exclusionCounts),
                },
                providerMetadata: safeProviderMetadata(row.providerStatus),
                persistence: {
                    source: 'database',
                    lastAttemptedAt: attemptedAt,
                    lastSuccessAt: succeededAt,
                    nextRefreshAt,
                    contentHash: row.contentHash,
                },
            })
            snapshotLoaded.add(row.chainId)
            loaded += 1
        }
        if (loaded > 0) publishProgressiveCombinedCatalog()
        return { loaded, ignored, degraded: false }
    }

    async function loadSnapshotOnce(chainId: number) {
        if (snapshotLoaded.has(chainId)) return
        snapshotLoaded.add(chainId)
        if (chainId !== 56) return
        const snapshot = await resolved.loadSnapshot()
        if (!snapshot) return
        const config = getApiConfig()
        const cacheTtlMs = Math.min(
            config.market.catalogTtlMs,
            config.dexPaprika.cacheTtlMs,
        )
        const staleTtlMs = Math.min(
            config.market.staleTtlMs,
            config.dexPaprika.staleTtlMs,
        )
        catalogCaches.set(chainId, {
            ...snapshot,
            expiresAt: snapshot.generatedAt + cacheTtlMs,
            staleUntil: snapshot.generatedAt + staleTtlMs,
            partial: false,
            catalogUnavailable: false,
            providerMetadata: {
                availableProviders: [],
                unavailableProviders: [],
            },
            persistence: emptyPersistence('memory'),
        })
    }

    function providerBackoffKey(
        chainId: number,
        provider: MarketCatalogProvider,
    ) {
        return `${chainId}:${provider}`
    }

    async function runProvider<T>({
        chainId,
        provider,
        operation,
        capable,
        run,
    }: {
        chainId: number
        provider: MarketCatalogProvider
        operation: string
        capable: boolean
        run: () => Promise<T>
    }): Promise<
        | { ok: true; value: T }
        | { ok: false; failure: MarketProviderFailure }
    > {
        if (!capable) {
            return {
                ok: false,
                failure: {
                    provider,
                    code: 'PROVIDER_UNSUPPORTED',
                    operation,
                    upstreamStatus: null,
                    retryAfterMs: 0,
                },
            }
        }
        const key = providerBackoffKey(chainId, provider)
        const blocked = providerBackoff.get(key)
        const now = resolved.now()
        if (blocked && blocked.nextAttemptAt > now) {
            return {
                ok: false,
                failure: {
                    provider,
                    code: blocked.code,
                    operation,
                    upstreamStatus: null,
                    retryAfterMs: blocked.nextAttemptAt - now,
                },
            }
        }
        try {
            const value = await run()
            providerBackoff.delete(key)
            return { ok: true, value }
        } catch (error) {
            const safe = safeProviderFailure(error)
            let retryAfterMs = 0
            if (safe.retryable) {
                const failures = (blocked?.failures ?? 0) + 1
                retryAfterMs = Math.min(
                    MARKET_PROVIDER_BACKOFF_INITIAL_MS * 2 ** (failures - 1),
                    MARKET_PROVIDER_BACKOFF_MAX_MS,
                )
                retryAfterMs = Math.max(retryAfterMs, safe.retryAfterMs)
                providerBackoff.set(key, {
                    failures,
                    nextAttemptAt: now + retryAfterMs,
                    code: safe.code,
                })
            } else {
                providerBackoff.delete(key)
            }
            return {
                ok: false,
                failure: {
                    provider,
                    code: safe.code,
                    operation,
                    upstreamStatus: safe.upstreamStatus,
                    retryAfterMs,
                },
            }
        }
    }

    async function buildCatalog(chainId: number): Promise<CatalogCache> {
        const config = getApiConfig()
        const chain = requireActiveTokenDiscoveryChain(chainId)
        const availableProviders = new Set<MarketCatalogProvider>()
        const unavailableProviders: MarketProviderFailure[] = []
        const dexPaprikaOutcome = config.dexPaprika.enabled
            ? await runProvider({
                  chainId,
                  provider: 'dexpaprika',
                  operation: 'token-search',
                  capable: getDexPaprikaNetworkId(chainId) !== null,
                  run: () => resolved.discoverDexPaprika({
                      chainId,
                      limit: config.dexPaprika.perChainLimit,
                      liquidityMinimumUsd: config.dexPaprika.minimumLiquidityUsd,
                      transactionMinimum24h: config.dexPaprika.minimumTransactions24h,
                  }),
              })
            : null
        if (dexPaprikaOutcome?.ok) availableProviders.add('dexpaprika')
        else if (dexPaprikaOutcome) unavailableProviders.push(dexPaprikaOutcome.failure)
        const dexPaprika = dexPaprikaOutcome?.ok
            ? dexPaprikaOutcome.value
            : null
        const discoveryOutcome = (dexPaprika?.tokens.length ?? 0) === 0
            ? await runProvider({
            chainId,
            provider: 'geckoterminal',
            operation: 'candidate-discovery',
            capable: chain.capabilities.geckoTerminal,
            run: () => resolved.discoverCandidates({
                chainId,
                minimumCandidates: config.market.candidateLimit,
            }),
        })
            : null
        const discovery = discoveryOutcome?.ok
            ? asDiscoveryResult(discoveryOutcome.value)
            : { candidates: [], pagesCompleted: 0, partial: discoveryOutcome !== null }
        if (discoveryOutcome?.ok) availableProviders.add('geckoterminal')
        else if (discoveryOutcome) unavailableProviders.push(discoveryOutcome.failure)
        const dexPaprikaCandidates: TokenCandidate[] = (dexPaprika?.tokens ?? []).map((token) => ({
            address: token.address,
            name: token.name,
            symbol: token.symbol,
            decimals: token.decimals,
            imageUrl: null,
            coinGeckoId: null,
            priceUSD: token.priceUSD,
            imageSource: null,
        }))
        const candidates = uniqueCandidates([
            ...dexPaprikaCandidates,
            ...discovery.candidates,
        ]).slice(
            0,
            config.market.candidateLimit,
        )
        const recognitionOutcome = candidates.length === 0
            ? null
            : await runProvider({
                  chainId,
                  provider: 'coingecko',
                  operation: 'token-recognition',
                  capable: chain.capabilities.coinGeckoOnchain,
                  run: () => resolved.fetchRecognized(
                candidates.map((candidate) => candidate.address),
                undefined,
                chainId,
                  ),
              })
        const marketOutcome = candidates.length === 0
            ? null
            : await runProvider({
                  chainId,
                  provider: 'dexscreener',
                  operation: 'market-enrichment',
                  capable: chain.capabilities.dexScreener,
                  run: () => resolved.fetchMarkets(
                candidates.map((candidate) => candidate.address),
                undefined,
                chainId,
                  ),
              })
        if (recognitionOutcome?.ok) availableProviders.add('coingecko')
        else if (recognitionOutcome) unavailableProviders.push(recognitionOutcome.failure)
        if (marketOutcome?.ok) availableProviders.add('dexscreener')
        else if (marketOutcome) unavailableProviders.push(marketOutcome.failure)
        if (discoveryOutcome?.ok && discovery.partial) {
            unavailableProviders.push({
                provider: 'geckoterminal',
                code: 'PROVIDER_PARTIAL',
                operation: 'candidate-discovery',
                upstreamStatus: null,
                retryAfterMs: config.market.partialRetryMs,
            })
        }
        if (recognitionOutcome?.ok && recognitionOutcome.value.partial) {
            unavailableProviders.push({
                provider: 'coingecko',
                code: 'PROVIDER_PARTIAL',
                operation: 'token-recognition',
                upstreamStatus: null,
                retryAfterMs: config.market.partialRetryMs,
            })
        }
        if (marketOutcome?.ok && marketOutcome.value.partial) {
            unavailableProviders.push({
                provider: 'dexscreener',
                code: 'PROVIDER_PARTIAL',
                operation: 'market-enrichment',
                upstreamStatus: null,
                retryAfterMs: config.market.partialRetryMs,
            })
        }

        const marketBatch = marketOutcome?.ok
            ? asMarketResult(marketOutcome.value)
            : {
                  markets: new Map<string, TokenMarket>(),
                  partial: candidates.length > 0,
                  successfulBatches: 0,
                  failedBatches: candidates.length > 0 ? 1 : 0,
              }
        const fallbackRecognition = recognitionFromGeckoTerminal(
            discovery.candidates,
        )
        const recognition = recognitionOutcome?.ok
            ? {
                  ...recognitionOutcome.value,
                  tokens: new Map([
                      ...fallbackRecognition,
                      ...recognitionOutcome.value.tokens,
                  ]),
              }
            : {
                  tokens: fallbackRecognition,
                  partial: true,
                  successfulBatches: 0,
                  failedBatches: candidates.length > 0 ? 1 : 0,
              }
        const generatedAt = resolved.now()
        const dexPaprikaMarkets = new Map((dexPaprika?.tokens ?? []).map((token) => [
            token.address,
            {
                address: token.address,
                name: token.name,
                symbol: token.symbol,
                priceUSD: token.priceUSD,
                volume24hUsd: token.volume24hUsd,
                liquidityUsd: token.liquidityUsd,
                pairCount: token.poolsCount ?? 0,
                pairUrl: null,
                oldestPairCreatedAt: token.createdAt,
            } satisfies TokenMarket,
        ]))
        const composedMarkets = new Map([
            ...marketBatch.markets,
            ...dexPaprikaMarkets,
        ])
        const established = await buildEstablishedTokens({
            chainId,
            candidates,
            recognized: recognition.tokens,
            markets: composedMarkets,
            dependencies: resolved,
            now: generatedAt,
        })

        let tokens: MarketToken[] = established.tokens
        const providerPartial =
            discovery.partial ||
            recognition.partial ||
            marketBatch.partial ||
            Boolean(dexPaprika?.partial) ||
            unavailableProviders.some((failure) => failure.code !== 'PROVIDER_UNSUPPORTED')
        if (
            (providerPartial || established.optionalFallbackAddresses.size > 0) &&
            candidates.length > 0
        ) {
            const recognizedCandidates = candidates.map((candidate) =>
                recognition.tokens.get(candidate.address) ?? candidate,
            )
            let eligibleCandidates = marketOutcome?.ok
                ? recognizedCandidates.filter((candidate) =>
                      marketReasons(
                          composedMarkets.get(candidate.address),
                          generatedAt,
                      ).failures.length === 0,
                  )
                : recognizedCandidates
            if (!providerPartial) {
                eligibleCandidates = eligibleCandidates.filter((candidate) =>
                    established.optionalFallbackAddresses.has(candidate.address),
                )
            }
            const fallbackTokens = await enrichSearchCandidates({
                chainId,
                candidates: eligibleCandidates,
                markets: composedMarkets,
                dependencies: resolved,
            })
            const merged = new Map(
                fallbackTokens.map((token) => [token.address, token]),
            )
            for (const token of established.tokens) merged.set(token.address, token)
            tokens = marketOutcome?.ok
                ? rankTokens([...merged.values()])
                : [...merged.values()].map((token, index) => ({
                      ...token,
                      rank: index + 1,
                  }))
        }

        const dexPaprikaByAddress = new Map(
            (dexPaprika?.tokens ?? []).map((token) => [token.address, token]),
        )
        tokens = tokens.map((token) => {
            const metrics = dexPaprikaByAddress.get(token.address)
            return metrics ? {
                ...token,
                marketPriceUSD: metrics.marketPriceUSD,
                priceChange24hPercent: metrics.priceChange24hPercent,
                volume7dUsd: metrics.volume7dUsd,
                volume30dUsd: metrics.volume30dUsd,
                fdvUsd: metrics.fdvUsd,
                transactions24h: metrics.transactions24h,
                poolsCount: metrics.poolsCount,
                createdAt: metrics.createdAt,
                hasProviderImage: metrics.hasProviderImage,
            } : token
        })

        const partial = providerPartial
        const stats: CatalogStats = {
            candidatesInspected: candidates.length,
            recognizedCandidates: established.recognizedCount,
            establishedTokens: established.tokens.length,
            pagesCompleted: discovery.pagesCompleted,
            providerPartial: partial,
            providerFailures: {
                dexPaprika: !dexPaprikaOutcome?.ok,
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
                    : Math.min(config.market.catalogTtlMs, config.dexPaprika.cacheTtlMs)),
            staleUntil: generatedAt + Math.min(
                config.market.staleTtlMs,
                config.dexPaprika.staleTtlMs,
            ),
            partial,
            catalogUnavailable: tokens.length === 0 && unavailableProviders.length > 0,
            tokens: tokens.slice(0, config.market.defaultLimit),
            commonTokens: curatedCommonTokens(chainId),
            stats,
            providerMetadata: {
                availableProviders: [...availableProviders],
                unavailableProviders,
            },
            persistence: emptyPersistence('memory'),
        }
    }

    function publishProgressiveCombinedCatalog() {
        if (!combinedCatalog) return

        const catalogs = ACTIVE_TOKEN_DISCOVERY_CHAINS.flatMap((chain) => {
            const catalog = catalogCaches.get(chain.chainId)
            return catalog ? [{ chainId: chain.chainId, catalog }] : []
        })
        const combinedCandidates = ACTIVE_TOKEN_DISCOVERY_CHAINS.flatMap((chain) => {
            const catalog = catalogCaches.get(chain.chainId)
            return catalog
                ? [...catalog.tokens.slice(0, 100), ...(catalog.commonTokens ?? [])]
                : curatedCommonTokens(chain.chainId)
        })
        const sections = composePublicCatalogTokens(combinedCandidates)
        const completedChainIds = new Set(catalogs.map(({ chainId }) => chainId))
        const publishedAt = resolved.now()
        const staleChainIds = catalogs.flatMap(({ chainId, catalog }) =>
            catalog.expiresAt <= publishedAt ? [chainId] : [],
        )
        const hardStale = catalogs.some(({ catalog }) =>
            catalog.staleUntil <= publishedAt)
        const partialChainIds = ACTIVE_TOKEN_DISCOVERY_CHAINS
            .filter((chain) => {
                const catalog = catalogCaches.get(chain.chainId)
                return !catalog || catalog.partial
            })
            .map((chain) => chain.chainId)
        const persistenceValues = catalogs.map(({ catalog }) => catalog.persistence)

        combinedCatalog = {
            generatedAt: publishedAt,
            tokens: [
                ...sections.tokens.slice(0, ACTIVE_TOKEN_DISCOVERY_CHAINS.length * 100),
                ...sections.commonTokens,
            ],
            chains: Object.fromEntries(ACTIVE_TOKEN_DISCOVERY_CHAINS.map((chain) => {
                const catalog = catalogCaches.get(chain.chainId)
                const chainSections = composePublicCatalogTokens(catalog
                    ? [...catalog.tokens, ...(catalog.commonTokens ?? [])]
                    : curatedCommonTokens(chain.chainId))
                return [String(chain.chainId), {
                    count: chainSections.tokens.length,
                    commonCount: chainSections.commonTokens.length,
                    stale: catalog ? catalog.expiresAt <= publishedAt : false,
                    partial: !catalog || catalog.partial,
                    providerStatus: catalog?.providerMetadata ?? {
                        availableProviders: [],
                        unavailableProviders: [],
                    },
                    exclusionCounts: catalog?.stats.exclusionReasons ?? {},
                }]
            })),
            unavailableChainIds: catalogs.flatMap(({ chainId, catalog }) =>
                catalog.catalogUnavailable ? [chainId] : [],
            ),
            staleChainIds,
            partialChainIds,
            partial: completedChainIds.size < ACTIVE_TOKEN_DISCOVERY_CHAINS.length ||
                partialChainIds.length > 0,
            stale: staleChainIds.length > 0,
            hardStale,
            persistence: {
                source: persistenceValues.some((value) => value.source === 'memory')
                    ? 'memory'
                    : persistenceValues.some((value) => value.source === 'database')
                      ? 'database'
                      : 'curated',
                lastAttemptedAt: Math.max(
                    ...persistenceValues.map((value) => value.lastAttemptedAt ?? 0),
                ) || null,
                lastSuccessAt: Math.max(
                    ...persistenceValues.map((value) => value.lastSuccessAt ?? 0),
                ) || null,
                nextRefreshAt: minimumTimestamp(
                    persistenceValues.map((value) => value.nextRefreshAt),
                ),
                contentHash: marketCatalogContentHash(
                    sections.tokens,
                    sections.commonTokens,
                ),
            },
        }
    }

    function refreshCatalog(chainId = 56) {
        const existingRefresh = refreshPromises.get(chainId)
        if (existingRefresh) return existingRefresh

        const refreshPromise = (async () => {
            const attempt = await recordPersistenceAttempt(chainId)
            const catalog = await buildCatalog(chainId)
            await resolved.persistence.recordAttempt({
                chainId,
                schemaVersion: MARKET_CATALOG_SCHEMA_VERSION,
                providerStatus: catalog.providerMetadata,
                lastAttemptedAt: new Date(attempt.attemptedAt),
                nextRefreshAt: new Date(attempt.nextRefreshAt),
            }).catch(() => reportPersistenceWarning(
                'MARKET_CATALOG_ATTEMPT_WRITE_FAILED',
            ))
            const nextSections = composePublicCatalogTokens([
                ...catalog.tokens,
                ...(catalog.commonTokens ?? []),
            ])
                const existing = catalogCaches.get(chainId)
                if (existing?.tokens.length) {
                    const existingSections = composePublicCatalogTokens([
                        ...existing.tokens,
                        ...(existing.commonTokens ?? []),
                    ])
                    const partialIsBetter = isPartialCatalogDemonstrablyBetter({
                        existingRankedCount: existingSections.tokens.length,
                        nextRankedCount: nextSections.tokens.length,
                        existingProviderCount:
                            existing.providerMetadata.availableProviders.length,
                        nextProviderCount:
                            catalog.providerMetadata.availableProviders.length,
                    })
                    if (
                        nextSections.tokens.length === 0 ||
                        (catalog.partial && !partialIsBetter)
                    ) {
                        const retained = {
                            ...existing,
                            partial: true,
                            providerMetadata: catalog.providerMetadata,
                            persistence: {
                                ...existing.persistence,
                                lastAttemptedAt: attempt.attemptedAt,
                                nextRefreshAt: attempt.nextRefreshAt,
                            },
                        }
                        catalogCaches.set(chainId, retained)
                        publishProgressiveCombinedCatalog()
                        return retained
                    }
                }
                const usefulCatalog = nextSections.tokens.length > 0
                const succeededAt = usefulCatalog ? resolved.now() : null
                const contentHash = marketCatalogContentHash(
                    nextSections.tokens,
                    nextSections.commonTokens,
                )
                catalog.persistence = {
                    source: 'memory',
                    lastAttemptedAt: attempt.attemptedAt,
                    lastSuccessAt: succeededAt,
                    nextRefreshAt: attempt.nextRefreshAt,
                    contentHash,
                }
                catalogCaches.set(chainId, catalog)
                if (succeededAt !== null) lastSuccessAt.set(chainId, succeededAt)
                publishProgressiveCombinedCatalog()
                nextRefreshAllowedAt.set(chainId, 0)
                if (succeededAt !== null) {
                    await resolved.persistence.saveUsefulCatalog({
                        chainId,
                        schemaVersion: MARKET_CATALOG_SCHEMA_VERSION,
                        rankedTokens: nextSections.tokens,
                        commonTokens: nextSections.commonTokens,
                        providerStatus: catalog.providerMetadata,
                        exclusionCounts: catalog.stats.exclusionReasons,
                        partial: catalog.partial,
                        generatedAt: new Date(catalog.generatedAt),
                        lastAttemptedAt: new Date(attempt.attemptedAt),
                        lastSuccessAt: new Date(succeededAt),
                        nextRefreshAt: new Date(attempt.nextRefreshAt),
                        contentHash,
                    }).catch(() => reportPersistenceWarning(
                        'MARKET_CATALOG_USEFUL_WRITE_FAILED',
                    ))
                }
                if (!catalog.partial && chainId === 56) {
                    await resolved
                        .saveSnapshot({
                            generatedAt: catalog.generatedAt,
                            schemaVersion: MARKET_CATALOG_SCHEMA_VERSION,
                            tokens: catalog.tokens,
                            stats: catalog.stats,
                        })
                        .catch(() => {
                            // Snapshot persistence is optional.
                        })
                }
                return catalog
            })()
            .finally(() => {
                refreshPromises.delete(chainId)
            })
        refreshPromises.set(chainId, refreshPromise)
        return refreshPromise
    }

    async function getCatalog(
        chainId = 56,
        { backgroundOnMiss = false }: { backgroundOnMiss?: boolean } = {},
    ) {
        await loadSnapshotOnce(chainId)
        const now = resolved.now()
        const catalogCache = catalogCaches.get(chainId)
        if (catalogCache && catalogCache.expiresAt > now) {
            return { catalog: catalogCache, stale: false, hardStale: false }
        }
        if (catalogCache) {
            return {
                catalog: catalogCache,
                stale: true,
                hardStale: catalogCache.staleUntil <= now,
            }
        }
        if (!backgroundOnMiss) {
            return {
                catalog: await refreshCatalog(chainId),
                stale: false,
                hardStale: false,
            }
        }
        const generatedAt = resolved.now()
        const fallback: CatalogCache = {
            generatedAt,
            expiresAt: generatedAt + getApiConfig().market.partialRetryMs,
            staleUntil: generatedAt + Math.min(
                getApiConfig().market.staleTtlMs,
                getApiConfig().dexPaprika.staleTtlMs,
            ),
            partial: true,
            catalogUnavailable: true,
            tokens: [],
            commonTokens: curatedCommonTokens(chainId),
            stats: {
                candidatesInspected: 0,
                recognizedCandidates: 0,
                establishedTokens: 0,
                pagesCompleted: 0,
                providerPartial: true,
                providerFailures: {
                    dexPaprika: true,
                    geckoTerminalPagination: true,
                    coinGeckoFailedBatches: 0,
                    dexScreenerFailedBatches: 0,
                },
                exclusionReasons: {},
            },
            providerMetadata: {
                availableProviders: [],
                unavailableProviders: [],
            },
            persistence: emptyPersistence('curated'),
        }
        catalogCaches.set(chainId, fallback)
        return { catalog: fallback, stale: false, hardStale: false }
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

        return tokens.map((value, index) => ({ ...value, rank: index + 1 }))
    }

    async function getTextSearch(chainId: number, query: string) {
        let candidates: TokenCandidate[] = []
        let markets = new Map<string, TokenMarket>()

        try {
            candidates = await resolved.searchCandidates(query, undefined, chainId)
        } catch {}
        if (candidates.length > 0) {
            try {
                markets = asMarketResult(
                    await resolved.fetchMarkets(
                        candidates.map((candidate) => candidate.address),
                        undefined,
                        chainId,
                    ),
                ).markets
            } catch {}
        } else {
            try {
                const fallbackMarkets = await resolved.searchMarkets(query, undefined, chainId)
                markets = new Map(
                    fallbackMarkets.map((market) => [market.address, market]),
                )
                candidates = fallbackMarkets.map(candidateFromMarket)
            } catch {}
        }

        if (candidates.length === 0) {
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
        setBoundedCacheEntry(searchCache, cacheKey, {
            tokens,
            expiresAt: resolved.now() + config.market.searchTtlMs,
        }, 500)
        return tokens
    }

    function refreshAllCatalogs() {
        if (refreshAllPromise) return refreshAllPromise
        refreshAllPromise = (async () => {
            const config = getApiConfig()
            const results = await boundedMap(
                ACTIVE_TOKEN_DISCOVERY_CHAINS,
                config.dexPaprika.refreshConcurrency,
                async (chain) => {
                    if (useProviderRefreshJitter) {
                        await new Promise((resolve) => setTimeout(
                            resolve,
                            50 + Math.floor(Math.random() * 100),
                        ))
                    }
                    return refreshCatalog(chain.chainId)
                },
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
                combinedCatalog = {
                    generatedAt: resolved.now(),
                    tokens: [],
                    chains: {},
                    unavailableChainIds: ACTIVE_TOKEN_DISCOVERY_CHAINS.map(
                        (chain) => chain.chainId,
                    ),
                    staleChainIds: [],
                    partialChainIds: [],
                    partial: true,
                    stale: false,
                    hardStale: false,
                    persistence: emptyPersistence('curated'),
                }
                return combinedCatalog
            }
            const combinedCandidates = successful.flatMap((catalog) => [
                ...catalog.tokens.slice(0, 100),
                ...(catalog.commonTokens ?? []),
            ])
            const combinedLimit = ACTIVE_TOKEN_DISCOVERY_CHAINS.length * 100
            const sections = composePublicCatalogTokens(combinedCandidates)
            const tokens = [
                ...sections.tokens.slice(0, combinedLimit),
                ...sections.commonTokens,
            ]
            const fulfilledByChain = results.flatMap((result, index) =>
                result.status === 'fulfilled'
                    ? [{
                          chainId: ACTIVE_TOKEN_DISCOVERY_CHAINS[index].chainId,
                          catalog: result.value,
                      }]
                    : [],
            )
            combinedCatalog = {
                generatedAt: resolved.now(),
                tokens,
                chains: Object.fromEntries(fulfilledByChain.map(({ chainId, catalog }) => [
                    String(chainId),
                    (() => {
                        const chainSections = composePublicCatalogTokens([
                            ...catalog.tokens,
                            ...(catalog.commonTokens ?? []),
                        ])
                        return {
                        count: chainSections.tokens.length,
                        commonCount: chainSections.commonTokens.length,
                        stale: false,
                        partial: catalog.partial,
                        providerStatus: catalog.providerMetadata,
                        exclusionCounts: catalog.stats.exclusionReasons,
                    }
                    })(),
                ])),
                unavailableChainIds: [
                    ...new Set([
                        ...unavailableChainIds,
                        ...fulfilledByChain.flatMap(({ chainId, catalog }) =>
                            catalog.catalogUnavailable
                                ? [chainId]
                                : [],
                        ),
                    ]),
                ],
                staleChainIds: [],
                partialChainIds: fulfilledByChain.flatMap(({ chainId, catalog }) =>
                    catalog.partial ? [chainId] : [],
                ),
                partial:
                    unavailableChainIds.length > 0 ||
                    successful.some((catalog) => catalog.partial),
                stale: false,
                hardStale: false,
                persistence: {
                    source: successful.some((catalog) =>
                        catalog.persistence.source === 'memory')
                        ? 'memory'
                        : 'database',
                    lastAttemptedAt: Math.max(...successful.map((catalog) =>
                        catalog.persistence.lastAttemptedAt ?? 0)) || null,
                    lastSuccessAt: Math.max(...successful.map((catalog) =>
                        catalog.persistence.lastSuccessAt ?? 0)) || null,
                    nextRefreshAt: minimumTimestamp(successful.map((catalog) =>
                        catalog.persistence.nextRefreshAt)),
                    contentHash: marketCatalogContentHash(
                        sections.tokens,
                        sections.commonTokens,
                    ),
                },
            }
            return combinedCatalog as CombinedCatalogCache
        })().finally(() => {
            refreshAllPromise = null
        })
        return refreshAllPromise
    }

    async function getCombinedCatalog() {
        if (combinedCatalog) {
            const apiConfig = getApiConfig()
            const config = {
                cacheTtlMs: Math.min(
                    apiConfig.market.catalogTtlMs,
                    apiConfig.dexPaprika.cacheTtlMs,
                ),
                staleTtlMs: Math.min(
                    apiConfig.market.staleTtlMs,
                    apiConfig.dexPaprika.staleTtlMs,
                ),
            }
            const age = resolved.now() - combinedCatalog.generatedAt
            if (age > config.cacheTtlMs) {
                return {
                    ...combinedCatalog,
                    chains: Object.fromEntries(Object.entries(combinedCatalog.chains)
                        .map(([chainId, chain]) => [chainId, { ...chain, stale: true }])),
                    staleChainIds: Object.keys(combinedCatalog.chains).map(Number),
                    partial: true,
                    stale: true,
                    hardStale: age > config.staleTtlMs,
                }
            }
            return combinedCatalog
        }
        const generatedAt = resolved.now()
        const sections = composePublicCatalogTokens(
            ACTIVE_TOKEN_DISCOVERY_CHAINS.flatMap((chain) =>
                curatedCommonTokens(chain.chainId),
            ),
        )
        const tokens = [...sections.tokens, ...sections.commonTokens]
        combinedCatalog = {
            generatedAt,
            tokens,
            chains: Object.fromEntries(ACTIVE_TOKEN_DISCOVERY_CHAINS.map((chain) => [
                String(chain.chainId),
                (() => {
                    const chainSections = composePublicCatalogTokens(
                        curatedCommonTokens(chain.chainId),
                    )
                    return {
                    count: 0,
                    commonCount: chainSections.commonTokens.length,
                    stale: false,
                    partial: true,
                    providerStatus: {
                        availableProviders: [],
                        unavailableProviders: [],
                    },
                    exclusionCounts: {},
                }
                })(),
            ])),
            unavailableChainIds: [],
            staleChainIds: [],
            partialChainIds: ACTIVE_TOKEN_DISCOVERY_CHAINS.map((chain) => chain.chainId),
            partial: true,
            stale: false,
            hardStale: false,
            persistence: {
                ...emptyPersistence('curated'),
                contentHash: marketCatalogContentHash(
                    sections.tokens,
                    sections.commonTokens,
                ),
            },
        }
        return combinedCatalog
    }

    function selectScheduledChain() {
        const now = resolved.now()
        return [...ACTIVE_TOKEN_DISCOVERY_CHAINS]
            .filter((chain) => !refreshPromises.has(chain.chainId))
            .filter((chain) =>
                (nextScheduledRefreshAt.get(chain.chainId) ?? 0) <= now)
            .sort((left, right) =>
                (lastSuccessAt.get(left.chainId) ?? 0) -
                    (lastSuccessAt.get(right.chainId) ?? 0) ||
                (lastAttemptedAt.get(left.chainId) ?? 0) -
                    (lastAttemptedAt.get(right.chainId) ?? 0) ||
                ACTIVE_TOKEN_DISCOVERY_CHAINS.indexOf(left) -
                    ACTIVE_TOKEN_DISCOVERY_CHAINS.indexOf(right),
            )[0] ?? null
    }

    async function runScheduledRefreshTick() {
        const chain = selectScheduledChain()
        if (!chain) return { chainId: null, refreshed: false as const }
        try {
            await refreshCatalog(chain.chainId)
            return { chainId: chain.chainId, refreshed: true as const }
        } catch {
            return { chainId: chain.chainId, refreshed: false as const }
        }
    }

    function startRollingRefresh({
        intervalMs = MARKET_CATALOG_ROLLING_REFRESH_MS,
        jitterMaxMs = MARKET_CATALOG_REFRESH_JITTER_MAX_MS,
        random = Math.random,
    }: {
        intervalMs?: number
        jitterMaxMs?: number
        random?: () => number
    } = {}) {
        if (schedulerStop) return schedulerStop
        let stopped = false
        const tick = async () => {
            if (stopped || schedulerTickInFlight) return
            schedulerTickInFlight = true
            try {
                await runScheduledRefreshTick()
            } finally {
                schedulerTickInFlight = false
            }
        }
        schedulerStop = () => {
            stopped = true
            if (schedulerTimer) clearTimeout(schedulerTimer)
            schedulerTimer = null
            schedulerTickInFlight = false
            schedulerStop = null
        }
        const jitter = Math.max(0, Math.floor(random() * (jitterMaxMs + 1)))
        schedulerTimer = setTimeout(() => {
            void tick()
            if (stopped) return
            schedulerTimer = setInterval(() => void tick(), intervalMs)
            schedulerTimer.unref?.()
        }, intervalMs + jitter)
        schedulerTimer.unref?.()
        return schedulerStop
    }

    return {
        getCatalog,
        getCombinedCatalog,
        getSearch,
        hydratePersistentCatalogs,
        refreshAllCatalogs,
        refreshCatalog,
        runScheduledRefreshTick,
        selectScheduledChain,
        startRollingRefresh,
        setPersistenceWarningHandler(handler: ((code: string) => void) | null) {
            persistenceWarningHandler = handler
        },
        getCatalogCacheDiagnostic(chainId: number) {
            const catalog = catalogCaches.get(chainId)
            return {
                chainId,
                memoryRankedCount: catalog
                    ? composePublicCatalogTokens(catalog.tokens).tokens.length
                    : 0,
                memoryCommonCount: catalog?.commonTokens?.length ?? 0,
                lastAttemptedAt: lastAttemptedAt.get(chainId) ??
                    catalog?.persistence.lastAttemptedAt ?? null,
                lastSuccessAt: lastSuccessAt.get(chainId) ??
                    catalog?.persistence.lastSuccessAt ?? null,
                nextRefreshAt: nextScheduledRefreshAt.get(chainId) ??
                    catalog?.persistence.nextRefreshAt ?? null,
                source: catalog?.persistence.source ?? 'curated',
                contentHash: catalog?.persistence.contentHash ?? null,
                inFlight: refreshPromises.has(chainId),
            }
        },
        isSchedulerRunningForTest() {
            return schedulerStop !== null
        },
        getProviderBackoffForTest(
            chainId: number,
            provider: MarketCatalogProvider,
        ) {
            return providerBackoff.get(providerBackoffKey(chainId, provider)) ?? null
        },
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
    const tokenLogo = getTrustedNativeAssetImage(chain.native.coinGeckoId)
    const logoCandidates = [tokenLogo, '/icons/token-fallback.svg'].filter(
        (value): value is string => value !== null,
    )
    return {
        id: createTokenId(chainId, NATIVE_TOKEN_ADDRESS),
        chainId,
        address: NATIVE_TOKEN_ADDRESS,
        name: chain.native.name,
        symbol: chain.native.symbol,
        decimals: chain.native.decimals,
        logoURI: logoCandidates[0],
        logoCandidates,
        logoSource: tokenLogo ? 'coingecko' : 'fallback',
        chainLogoURI: chain.chainLogoURI,
        coinGeckoId: chain.native.coinGeckoId,
        priceUSD,
        volume24hUsd: null,
        liquidityUsd: null,
        pairCount: null,
        oldestPairCreatedAt: null,
        marketUrl: null,
        rank: 1,
        verificationStatus: 'established',
        recognitionStatus: 'established',
        verificationReasons: ['explicit-native-allowlist'],
        verifiedContract: true,
        visibility: 'primary',
        securityStatus: 'trusted',
        source: 'curated',
        catalogSection: 'common',
        isNative: true,
    }
}

function curatedCommonTokens(chainId: number): MarketToken[] {
    const chain = requireActiveTokenDiscoveryChain(chainId)
    const wrappedLogo = buildTokenLogo({
        chainId,
        address: chain.wrappedNative.address,
    })
    const wrapped: MarketToken = {
        id: createTokenId(chainId, chain.wrappedNative.address),
        chainId,
        address: chain.wrappedNative.address,
        name: chain.wrappedNative.name,
        symbol: chain.wrappedNative.symbol,
        decimals: chain.wrappedNative.decimals,
        ...wrappedLogo,
        chainLogoURI: chain.chainLogoURI,
        coinGeckoId: null,
        priceUSD: null,
        volume24hUsd: null,
        liquidityUsd: null,
        pairCount: null,
        oldestPairCreatedAt: null,
        marketUrl: null,
        rank: null,
        verificationStatus: 'established',
        recognitionStatus: 'established',
        verificationReasons: ['curated-official-contract'],
        verifiedContract: true,
        visibility: 'primary',
        securityStatus: 'trusted',
        source: 'curated',
        catalogSection: 'common',
    }
    const official = getOfficialAssetsForChain(chainId).map((asset): MarketToken => ({
        ...buildTokenLogo({
            chainId,
            address: asset.address,
            curatedImages: asset.logoCandidates,
        }),
        id: createTokenId(chainId, asset.address),
        chainId,
        address: asset.address,
        name: asset.name,
        symbol: asset.symbol,
        decimals: asset.decimals,
        chainLogoURI: chain.chainLogoURI,
        coinGeckoId: asset.coinGeckoId,
        priceUSD: null,
        volume24hUsd: null,
        liquidityUsd: null,
        pairCount: null,
        oldestPairCreatedAt: null,
        marketUrl: null,
        rank: null,
        verificationStatus: asset.recognitionStatus,
        recognitionStatus: asset.recognitionStatus,
        verificationReasons: ['curated-official-contract'],
        verifiedContract: true,
        visibility: 'primary',
        securityStatus: 'trusted',
        source: 'curated',
        catalogSection: 'common',
    }))
    return [...new Map(
        [nativeMarketToken(chainId, null), wrapped, ...official]
            .map((token) => [token.id, token]),
    ).values()]
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

function publicPersistence(metadata: CatalogPersistenceMetadata) {
    return {
        source: metadata.source,
        lastSuccessAt: metadata.lastSuccessAt === null
            ? null
            : new Date(metadata.lastSuccessAt).toISOString(),
        nextRefreshAt: metadata.nextRefreshAt === null
            ? null
            : new Date(metadata.nextRefreshAt).toISOString(),
    }
}

function applyCatalogEtag(
    reply: FastifyReply,
    ifNoneMatch: string | string[] | undefined,
    tokens: readonly MarketToken[],
    commonTokens: readonly MarketToken[],
) {
    const etag = `"market-v${MARKET_CATALOG_SCHEMA_VERSION}-${
        marketCatalogContentHash(tokens, commonTokens)
    }"`
    reply.header('etag', etag)
    const values = Array.isArray(ifNoneMatch)
        ? ifNoneMatch
        : String(ifNoneMatch ?? '').split(',')
    return values.some((value) => value.trim() === etag || value.trim() === '*')
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
                    rateLimit: {
                        max: getApiConfig().market.routeRateLimitPerMinute,
                        timeWindow: '1 minute',
                    },
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

                const combinedLimit = ACTIVE_TOKEN_DISCOVERY_CHAINS.length * 100
                const maximum = allChains && !query
                    ? combinedLimit
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
                            const filtered = filterEligibleVolumeTokens(combined.tokens)
                            const sections = composePublicCatalogTokens(combined.tokens)
                            const tokens = sections.tokens.slice(0, limit)
                            const commonTokens = sections.commonTokens
                            reply.header('cache-control', 'public, max-age=300')
                            if (applyCatalogEtag(
                                reply,
                                request.headers['if-none-match'],
                                tokens,
                                commonTokens,
                            )) return reply.code(304).send()
                            return {
                                schemaVersion: MARKET_CATALOG_SCHEMA_VERSION,
                                chainId: 'all',
                                query,
                                count: tokens.length,
                                commonCount: commonTokens.length,
                                stale: combined.stale ?? false,
                                partial: combined.partial ??
                                    combined.unavailableChainIds.length > 0,
                                hardStale: combined.hardStale ?? false,
                                catalogUnavailable: tokens.length === 0,
                                generatedAt: new Date(
                                    combined.generatedAt,
                                ).toISOString(),
                                chains: combined.chains,
                                unavailableChainIds: combined.unavailableChainIds,
                                staleChainIds: combined.staleChainIds,
                                partialChainIds: combined.partialChainIds,
                                commonTokens,
                                persistence: publicPersistence(
                                    combined.persistence ?? emptyPersistence('memory'),
                                ),
                                metadata: {
                                    searchedChains:
                                        ACTIVE_TOKEN_DISCOVERY_CHAINS.length,
                                    unavailableChainIds:
                                        combined.unavailableChainIds,
                                    perChainLimit: 100,
                                    combinedLimit,
                                    exclusionReasons: filtered.exclusionReasons,
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
                                        .filter((token) =>
                                            token.logoURI &&
                                            (token.volume24hUsd ?? 0) > 0,
                                        )
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
                                    : (right.volume24hUsd ?? 0) -
                                      (left.volume24hUsd ?? 0),
                            )
                            .slice(0, limit)
                        const unavailableChainIds = results.flatMap((result, index) =>
                            result.status === 'rejected'
                                ? [targetChains[index].chainId]
                                : [],
                        )
                        reply.header('cache-control', 'public, max-age=60')
                        return {
                            schemaVersion: MARKET_CATALOG_SCHEMA_VERSION,
                            chainId: 'all',
                            query,
                            count: tokens.length,
                            commonCount: 0,
                            commonTokens: [],
                            stale: groups.some((group) => group.stale),
                            partial: unavailableChainIds.length > 0,
                            hardStale: false,
                            catalogUnavailable: tokens.length === 0,
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
                            schemaVersion: MARKET_CATALOG_SCHEMA_VERSION,
                            chainId: selectedChainId,
                            query,
                            count: Math.min(tokens.length, limit),
                            commonCount: 0,
                            commonTokens: [],
                            stale: false,
                            partial: false,
                            hardStale: false,
                            catalogUnavailable: false,
                            metadata: {
                                classifications: ['recognized', 'unverified'],
                            },
                            tokens: tokens.slice(0, limit),
                        }
                    }

                    const { catalog, stale, hardStale } =
                        await service.getCatalog(selectedChainId, {
                            backgroundOnMiss: true,
                        })
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
                    const catalogNative = catalog.tokens.find(
                        (token) => token.address === NATIVE_TOKEN_ADDRESS,
                    )
                    const catalogCandidates = [
                        catalogNative ?? nativeMarketToken(
                            selectedChainId,
                            wrapped?.priceUSD ?? null,
                        ),
                        ...catalog.tokens.filter(
                            (token) => token.address !== NATIVE_TOKEN_ADDRESS,
                        ),
                        ...(catalog.commonTokens ?? []),
                    ]
                    const filtered = filterEligibleVolumeTokens(catalogCandidates)
                    const sections = composePublicCatalogTokens(catalogCandidates)
                    const tokens = sections.tokens.slice(0, limit)
                    const commonTokens = sections.commonTokens
                    for (const failure of catalog.providerMetadata.unavailableProviders) {
                        const rateLimited = failure.upstreamStatus === 429 ||
                            failure.code === 'PROVIDER_RATE_LIMITED'
                        const log = rateLimited && (tokens.length > 0 || commonTokens.length > 0)
                            ? request.log.info.bind(request.log)
                            : request.log.warn.bind(request.log)
                        log({
                            requestId: request.id,
                            chainId: selectedChainId,
                            provider: failure.provider,
                            operation: failure.operation,
                            safeCode: rateLimited
                                ? 'PROVIDER_RATE_LIMITED'
                                : failure.code,
                            upstreamStatus: failure.upstreamStatus,
                            cacheStatus: hardStale
                                ? 'hard-stale'
                                : stale
                                  ? 'stale'
                                  : 'refresh',
                            retryAfterMs: failure.retryAfterMs,
                            partialResultAvailable: tokens.length > 0 || commonTokens.length > 0,
                            ...(rateLimited && (tokens.length > 0 || commonTokens.length > 0)
                                ? { fallback: stale ? 'cache' : 'curated' }
                                : {}),
                        }, 'Market token provider request was partially unavailable')
                    }
                    if (applyCatalogEtag(
                        reply,
                        request.headers['if-none-match'],
                        tokens,
                        commonTokens,
                    )) return reply.code(304).send()
                    return {
                        schemaVersion: MARKET_CATALOG_SCHEMA_VERSION,
                        chainId: selectedChainId,
                        query,
                        count: tokens.length,
                        commonCount: commonTokens.length,
                        commonTokens,
                        stale,
                        partial: stale || catalog.partial,
                        hardStale,
                        catalogUnavailable: catalog.catalogUnavailable,
                        generatedAt: new Date(catalog.generatedAt).toISOString(),
                        persistence: publicPersistence(
                            catalog.persistence ?? emptyPersistence('memory'),
                        ),
                        metadata: {
                            classification: 'established',
                            ...catalog.stats,
                            exclusionReasons: {
                                ...catalog.stats.exclusionReasons,
                                ...filtered.exclusionReasons,
                            },
                            ...catalog.providerMetadata,
                        },
                        tokens,
                    }
                } catch (error) {
                    const safe = getSafeError(error)
                    request.log.warn(
                        {
                            requestId: request.id,
                            chainId,
                            provider: error instanceof ProviderError &&
                                error.providers?.[0]?.provider
                                ? error.providers[0].provider
                                : 'market-catalog',
                            operation: query ? 'search' : 'catalog-refresh',
                            safeCode: safe.body.error.code,
                            upstreamStatus: error instanceof ProviderError
                                ? error.upstreamStatus
                                : null,
                            cacheStatus: 'miss',
                            retryAfterMs: 0,
                            partialResultAvailable: true,
                        },
                        'Market token provider request failed',
                    )
                    const fallbackTokens = chainId === null || query
                        ? []
                        : curatedCommonTokens(chainId).map((token) =>
                            normalizePublicMarketToken(token, 'common'))
                    return reply.code(200).send({
                        schemaVersion: MARKET_CATALOG_SCHEMA_VERSION,
                        chainId: chainId ?? 'all',
                        query,
                        count: 0,
                        commonCount: fallbackTokens.length,
                        stale: false,
                        partial: true,
                        hardStale: false,
                        catalogUnavailable: true,
                        persistence: publicPersistence(emptyPersistence('curated')),
                        metadata: {
                            availableProviders: [],
                            unavailableProviders: [{
                                provider: 'market-catalog',
                                code: safe.body.error.code,
                            }],
                        },
                        commonTokens: fallbackTokens,
                        tokens: [],
                    })
                } finally {
                    request.raw.off('aborted', abort)
                }
            },
        )
    }
}

export const marketCatalogService = createMarketCatalogService()
export const marketTokenRoutes = createMarketTokenRoutes(marketCatalogService)
