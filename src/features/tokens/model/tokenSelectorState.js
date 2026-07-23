import {
    compareDecimalStrings,
} from '../services/portfolio.js'
import {
    getCanonicalTokenIdentity,
    mergeCanonicalTokenRecords,
} from '../services/marketTokens.js'
import {
    resolveWalletUsdValue,
} from '../services/walletTokens.js'

const CORE_CURATED_REASONS = new Set([
    'native-token',
    'native-bnb',
    'curated-official-contract',
    'manual-allowlist',
    'pancakeswap-curated-list',
    'trustwallet-reviewed-asset',
])

/** Returns the canonical identity used to compare token records safely. */
export function getTokenKey(token) {
    return getCanonicalTokenIdentity(token)
}

/** Normalizes an address for exact, case-insensitive search matching. */
export function normalizeAddress(address) {
    return String(address ?? '').trim().toLowerCase()
}

/** Returns whether a token matches a name, symbol, or address query locally. */
export function tokenMatchesSearch(token, query) {
    const normalizedQuery = String(query ?? '').trim().toLowerCase()
    if (!normalizedQuery) return true

    return [
        token?.name,
        token?.symbol,
        token?.address,
    ].some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery))
}

/** Formats a contract address for the selector metadata line. */
export function shortenAddress(address) {
    const normalized = String(address ?? '').trim()
    if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) return null
    return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`
}

/** Returns whether a wallet record has a strictly positive raw or decimal balance. */
export function hasPositiveBalance(token) {
    if (/^\d+$/.test(String(token?.rawBalance ?? ''))) {
        return BigInt(token.rawBalance) > 0n
    }
    return /^\d+(?:\.\d+)?$/.test(String(token?.balance ?? '')) &&
        /[1-9]/.test(String(token.balance))
}

/** Deduplicates records by canonical chain/address identity while preserving merged metadata. */
export function deduplicateTokens(tokens) {
    const map = new Map()
    for (const token of tokens) {
        const identity = getTokenKey(token)
        if (identity) map.set(identity, mergeCanonicalTokenRecords(map.get(identity), token))
    }
    return [...map.values()]
}

function compareDescendingDecimal(left, right) {
    return -(compareDecimalStrings(left ?? '0', right ?? '0') ?? 0)
}

function compareCanonicalIdentity(left, right) {
    return String(getTokenKey(left)).localeCompare(String(getTokenKey(right)))
}

function walletTrustTier(token) {
    if (token?.classificationTier === 'core') return 0
    if (token?.classificationTier === 'established') return 1
    if (token?.isNative === true || token?.officialAsset === true) return 0
    const reasons = Array.isArray(token?.recognitionReasons)
        ? token.recognitionReasons
        : Array.isArray(token?.verificationReasons)
          ? token.verificationReasons
          : []
    if (reasons.some((reason) => CORE_CURATED_REASONS.has(reason))) return 0
    return 2
}

/**
 * Sorts wallet records by identity confidence, trusted USD value, balance, and
 * deterministic identity. Curated/native assets cannot be displaced by an
 * implausibly priced merely-recognized token.
 */
export function sortWalletTokens(tokens) {
    return tokens.toSorted((left, right) => {
        const trustDifference = walletTrustTier(left) - walletTrustTier(right)
        if (trustDifference !== 0) return trustDifference

        const leftValue = resolveWalletUsdValue(left)
        const rightValue = resolveWalletUsdValue(right)
        if (leftValue !== null && rightValue !== null) {
            return compareDescendingDecimal(leftValue, rightValue) ||
                compareCanonicalIdentity(left, right)
        }
        if (leftValue !== null) return -1
        if (rightValue !== null) return 1
        return compareDescendingDecimal(left.balance, right.balance) ||
            compareCanonicalIdentity(left, right)
    })
}

/** Sorts market records by volume, liquidity, chain, and deterministic identity. */
export function sortGlobalMarketTokens(tokens) {
    return tokens.toSorted((left, right) =>
        compareDescendingDecimal(left.volume24hUsd, right.volume24hUsd) ||
        compareDescendingDecimal(left.liquidityUsd, right.liquidityUsd) ||
        Number(left.chainId) - Number(right.chainId) ||
        compareCanonicalIdentity(left, right),
    )
}

/** Strips recent-search records to the persisted safe token shape. */
export function sanitizeStoredToken(token) {
    if (!getTokenKey(token)) return null
    const logoCandidates = [
        ...(Array.isArray(token.logoCandidates) ? token.logoCandidates : []),
        token.logoURI,
        token.iconUrl,
    ].filter((value, index, values) =>
        typeof value === 'string' && value.length > 0 && values.indexOf(value) === index)
    return {
        classificationVersion: token.classificationVersion ?? null,
        id: token.id ?? null,
        chainId: Number(token.chainId ?? 0),
        address: token.address ?? '',
        symbol: token.symbol ?? '',
        name: token.name ?? token.symbol ?? 'Unknown token',
        decimals: Number(token.decimals ?? 18),
        logoURI: logoCandidates[0] ?? null,
        iconUrl: logoCandidates[0] ?? null,
        logoCandidates,
        logoSource: token.logoSource ?? (logoCandidates.length > 0 ? 'local' : 'fallback'),
        chainLogoURI: token.chainLogoURI ?? token.networkLogoURI ?? null,
        networkLogoURI: token.networkLogoURI ?? token.chainLogoURI ?? null,
        balance: String(token.balance ?? '0'),
        priceUSD: token.priceUSD ?? null,
        coinGeckoId: token.coinGeckoId ?? token.coingeckoId ?? token.coingecko_coin_id ?? null,
        recognitionStatus: token.recognitionStatus ?? 'unverified',
        recognitionReasons: token.recognitionReasons ?? [],
        spamStatus: token.spamStatus ?? 'unknown',
        possibleSpam: token.possibleSpam ?? null,
        verifiedContract: token.verifiedContract ?? null,
        spamReasons: token.spamReasons ?? [],
        securityStatus: token.securityStatus ?? 'unknown',
        securityReasons: token.securityReasons ?? [],
        visibility: token.visibility ?? 'hidden',
        priceConfidence: token.priceConfidence ?? 'unknown',
        trustedPriceUSD: token.trustedPriceUSD ?? null,
        marketPriceUSD: token.marketPriceUSD ?? null,
        valueUSD: token.valueUSD ?? null,
        classificationTier: token.classificationTier ?? 'hidden',
        classificationReasons: Array.isArray(token.classificationReasons)
            ? token.classificationReasons
            : [],
    }
}

/** Returns the localStorage key for one chain's recent token searches. */
export function getRecentStorageKey(chainId) {
    const scope = String(chainId).trim().toLowerCase() === 'all' ? 'all' : Number(chainId)
    if (scope !== 'all' && (!Number.isSafeInteger(scope) || scope <= 0)) return null
    return ['pistachioswap', 'recent-token-searches', 'v4', scope].join(':')
}

/** Reads recent token records and fails closed when browser storage is unavailable or malformed. */
export function readRecentTokens(chainId) {
    if (typeof window === 'undefined') return []
    try {
        const key = getRecentStorageKey(chainId)
        if (!key) return []
        const value = window.localStorage.getItem(key)
        if (!value) return []
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

/** Writes recent token records without allowing storage errors to affect selection. */
export function writeRecentTokens(chainId, tokens) {
    try {
        const key = getRecentStorageKey(chainId)
        if (key) window.localStorage.setItem(key, JSON.stringify(tokens))
    } catch {
        // Browser storage may be unavailable.
    }
}
