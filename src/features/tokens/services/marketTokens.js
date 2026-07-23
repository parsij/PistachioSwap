import {
    CANONICAL_NATIVE_TOKEN_ADDRESS,
    getCanonicalTokenAddress,
    getCuratedEvmChain,
    getNativeTokenAliases,
    isTokenDiscoveryChainId,
} from '../../../web3/curatedEvmChains.js'

export const MARKET_TOKEN_CACHE_PREFIX =
    'pistachioswap:market-tokens:v6:'

const LEGACY_CACHE_PREFIXES = [
    'pistachioswap:market-tokens:v1:',
    'pistachioswap:market-tokens:v2:',
    'pistachioswap:market-tokens:v3:',
    'pistachioswap:market-tokens:v4:',
    'pistachioswap:market-tokens:v5:',
]

let legacyCacheMigrated = false

const CATALOG_CACHE_TTL_MS =
    10 * 60 * 1000

const PARTIAL_CATALOG_CACHE_TTL_MS =
    60 * 1000

const SEARCH_CACHE_TTL_MS =
    5 * 60 * 1000

const MAX_BROWSER_CACHE_ENTRIES = 25
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/
const inFlightRequests = new Map()

function normalizeSearch(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
}

export function normalizeMarketChainScope(value) {
    if (String(value).trim().toLowerCase() === 'all') return 'all'
    const chainId = Number(value)
    if (!Number.isSafeInteger(chainId) || !isTokenDiscoveryChainId(chainId)) {
        throw new Error('A valid token-discovery chain is required')
    }
    return chainId
}

export function getCanonicalTokenIdentity(token) {
    const chainId = Number(token?.chainId)
    const address = getCanonicalTokenAddress(chainId, token?.address)
    if (
        !Number.isSafeInteger(chainId) ||
        chainId <= 0 ||
        !address || !EVM_ADDRESS_PATTERN.test(address)
    ) {
        return null
    }
    return `${chainId}:${address}`
}

export function getMarketTokenExclusionReason(token) {
    const identity = getCanonicalTokenIdentity(token)
    if (!identity) return 'invalidIdentity'
    if (!['established', 'recognized'].includes(
        token?.verificationStatus ?? token?.recognitionStatus,
    )) return 'unverified'
    if (token?.possibleSpam === true) return 'possibleSpam'
    if (token?.visibility === 'hidden') return 'hidden'
    if (['high', 'blocked'].includes(token?.securityStatus)) {
        return 'securityBlocked'
    }
    const reasons = Array.isArray(token?.verificationReasons)
        ? token.verificationReasons
        : []
    const isNative = identity.endsWith(`:${CANONICAL_NATIVE_TOKEN_ADDRESS}`)
    if (!(isNative && reasons.includes('explicit-native-allowlist')) &&
        !reasons.some((reason) => [
            'coingecko-exact-contract',
            'curated-official-contract',
            'curated-token-allowlist',
            'trusted-asset-exact-contract',
            'pancakeswap-curated-list',
            'trustwallet-reviewed-asset',
        ].includes(reason))) return 'missingTrustedContractMatch'
    if (!String(token?.name ?? '').trim() || !String(token?.symbol ?? '').trim() ||
        !Number.isInteger(Number(token?.decimals)) || Number(token.decimals) < 0 ||
        Number(token.decimals) > 255) return 'invalidMetadata'
    if (!(Number(token?.volume24hUsd) > 0)) return 'missingVolume'
    if (!(Number(token?.liquidityUsd) > 0) ||
        (!reasons.includes('minimum-liquidity-met') &&
            !reasons.includes('minimum-trusted-liquidity-met'))) {
        return 'insufficientLiquidity'
    }
    if (token?.classificationTier !== undefined &&
        !['core', 'established'].includes(token.classificationTier)) return 'hidden'
    if (token?.includeInPortfolioValue === false ||
        token?.priceConfidence === 'untrusted' ||
        token?.priceConfidence === 'unknown') return 'hidden'
    return null
}

export function filterEligibleMarketTokens(tokens) {
    return tokens.filter((token) => getMarketTokenExclusionReason(token) === null)
}

export function isCuratedCommonMarketToken(token) {
    const reasons = Array.isArray(token?.verificationReasons)
        ? token.verificationReasons
        : Array.isArray(token?.recognitionReasons)
          ? token.recognitionReasons
          : []
    return getCanonicalTokenIdentity(token) !== null &&
        token?.source === 'curated' &&
        token?.catalogSection === 'common' &&
        reasons.some((reason) => [
            'coingecko-exact-contract',
            'curated-official-contract',
            'curated-token-allowlist',
            'trusted-asset-exact-contract',
            'pancakeswap-curated-list',
            'trustwallet-reviewed-asset',
            'explicit-native-allowlist',
        ].includes(reason)) &&
        ['established', 'recognized'].includes(
            token?.verificationStatus ?? token?.recognitionStatus,
        ) &&
        token?.visibility !== 'hidden' &&
        token?.possibleSpam !== true &&
        !['high', 'blocked'].includes(token?.securityStatus) &&
        Boolean(String(token?.name ?? '').trim()) &&
        Boolean(String(token?.symbol ?? '').trim()) &&
        Number.isInteger(Number(token?.decimals))
}

export function mergeCanonicalTokenRecords(left, right) {
    if (!left) return right
    if (!right) return left
    const leftIdentity = getCanonicalTokenIdentity(left)
    if (!leftIdentity || leftIdentity !== getCanonicalTokenIdentity(right)) return right
    const chainId = Number(right.chainId ?? left.chainId)
    const canonicalAddress = getCanonicalTokenAddress(chainId, right.address)
    const leftIsDirectNative = String(left.address).toLowerCase() ===
        CANONICAL_NATIVE_TOKEN_ADDRESS
    const rightIsDirectNative = String(right.address).toLowerCase() ===
        CANONICAL_NATIVE_TOKEN_ADDRESS
    const preferred = rightIsDirectNative || !leftIsDirectNative ? right : left
    const supplement = preferred === right ? left : right
    const nativeAlias = canonicalAddress === CANONICAL_NATIVE_TOKEN_ADDRESS &&
        getNativeTokenAliases(chainId).length > 0
    const chain = getCuratedEvmChain(chainId)
    const candidates = [
        ...(preferred.logoCandidates ?? []), preferred.logoURI,
        ...(supplement.logoCandidates ?? []), supplement.logoURI,
    ].filter((value, index, values) =>
        typeof value === 'string' && value && values.indexOf(value) === index,
    )
    return {
        ...supplement,
        ...preferred,
        ...(nativeAlias ? {
            address: CANONICAL_NATIVE_TOKEN_ADDRESS,
            id: `${chainId}:${CANONICAL_NATIVE_TOKEN_ADDRESS}`,
            isNative: true,
            name: chain?.nativeCurrency?.name === 'CELO' ? 'Celo' :
                chain?.nativeCurrency?.name ?? preferred.name,
            symbol: chain?.nativeCurrency?.symbol ?? preferred.symbol,
            providerTokenAliases: getNativeTokenAliases(chainId),
        } : {}),
        priceUSD: preferred.priceUSD ?? supplement.priceUSD ?? null,
        trustedPriceUSD: preferred.trustedPriceUSD ?? supplement.trustedPriceUSD ?? null,
        marketPriceUSD: preferred.marketPriceUSD ?? supplement.marketPriceUSD ?? null,
        valueUSD: preferred.valueUSD ?? supplement.valueUSD ?? null,
        logoURI: candidates[0] ?? null,
        logoCandidates: candidates,
    }
}

export function getMarketTokenCacheKey({
                         chainId,
                         query,
                         limit,
                     }) {
    return (
        MARKET_TOKEN_CACHE_PREFIX +
        encodeURIComponent(
            JSON.stringify({
                chainId: normalizeMarketChainScope(chainId),
                query: normalizeSearch(query),
                limit,
            }),
        )
    )
}

function readCacheEntry(key) {
    if (typeof window === 'undefined') {
        return null
    }

    try {
        const rawValue =
            window.localStorage.getItem(key)

        if (!rawValue) {
            return null
        }

        const entry = JSON.parse(rawValue)
        const defaultCatalog = !String(entry?.payload?.query ?? '').trim()

        if (
            !entry ||
            typeof entry.cachedAt !== 'number' ||
            !entry.payload ||
            entry.payload.schemaVersion !== 6 ||
            !Array.isArray(entry.payload.tokens) ||
            !Array.isArray(entry.payload.commonTokens) ||
            entry.payload.commonCount !== entry.payload.commonTokens.length ||
            entry.payload.tokens.some(
                (token) => getCanonicalTokenIdentity(token) === null ||
                    (defaultCatalog && (
                        !token.canonicalId || token.catalogSection !== 'volume' ||
                        !['established', 'recognized'].includes(token.recognitionStatus) ||
                        token.verifiedContract !== true || token.possibleSpam !== false ||
                        !Array.isArray(token.recognitionReasons) ||
                        !Array.isArray(token.logoCandidates)
                    )),
            ) ||
            entry.payload.commonTokens.some((token) =>
                getCanonicalTokenIdentity(token) === null ||
                token.catalogSection !== 'common' ||
                !Array.isArray(token.logoCandidates) ||
                (token.officialAsset === true && !token.logoCandidates.some(
                    (url) => url !== '/icons/token-fallback.svg',
                )),
            )
        ) {
            window.localStorage.removeItem(key)
            return null
        }

        return entry
    } catch {
        return null
    }
}

export function migrateLegacyMarketTokenCache() {
    if (
        legacyCacheMigrated ||
        typeof window === 'undefined'
    ) {
        return
    }

    legacyCacheMigrated = true

    try {
        for (
            let index = window.localStorage.length - 1;
            index >= 0;
            index -= 1
        ) {
            const key = window.localStorage.key(index)

            if (
                key &&
                LEGACY_CACHE_PREFIXES.some((prefix) =>
                    key.startsWith(prefix),
                )
            ) {
                window.localStorage.removeItem(key)
            }
        }
    } catch {
        // Storage can be unavailable in private mode.
    }
}

function pruneBrowserCache() {
    if (typeof window === 'undefined') {
        return
    }

    try {
        const entries = []

        for (
            let index = 0;
            index < window.localStorage.length;
            index += 1
        ) {
            const key =
                window.localStorage.key(index)

            if (
                !key ||
                !key.startsWith(MARKET_TOKEN_CACHE_PREFIX)
            ) {
                continue
            }

            const entry = readCacheEntry(key)

            if (!entry) {
                continue
            }

            entries.push({
                key,
                cachedAt: entry.cachedAt,
            })
        }

        entries.sort(
            (left, right) =>
                right.cachedAt - left.cachedAt,
        )

        for (
            const entry of entries.slice(
            MAX_BROWSER_CACHE_ENTRIES,
        )
            ) {
            window.localStorage.removeItem(
                entry.key,
            )
        }
    } catch {
        // Storage can be unavailable in private mode.
    }
}

function writeCacheEntry(key, payload, etag = null) {
    if (typeof window === 'undefined') {
        return
    }

    if (!Array.isArray(payload?.tokens) || payload.tokens.length === 0) {
        return
    }

    try {
        window.localStorage.setItem(
            key,
            JSON.stringify({
                cachedAt: Date.now(),
                payload,
                etag: typeof etag === 'string' && etag ? etag : null,
            }),
        )

        pruneBrowserCache()
    } catch {
        // Ignore quota and privacy-mode failures.
    }
}

export function clearMarketTokenCache() {
    if (typeof window === 'undefined') {
        return
    }

    for (
        let index =
            window.localStorage.length - 1;
        index >= 0;
        index -= 1
    ) {
        const key =
            window.localStorage.key(index)

        if (key?.startsWith(MARKET_TOKEN_CACHE_PREFIX)) {
            window.localStorage.removeItem(key)
        }
    }
}

/**
 * Fetches, normalizes, and caches a market catalog for a chain scope/search.
 * @param {object} input Endpoint/query/cache/abort options.
 * @returns {Promise<object>} Ranked/common tokens plus partial/stale metadata.
 * @sideEffects Performs backend HTTP and reads/writes browser cache.
 */
export async function fetchMarketTokens({
                                            chainId = 56,
                                            query = '',
                                            signal,
                                            forceRefresh = false,

                                            apiBaseUrl =
                                                import.meta.env.VITE_API_BASE_URL ??
                                                'http://localhost:3001',
                                        } = {}) {
    migrateLegacyMarketTokenCache()

    const normalizedQuery =
        normalizeSearch(query)
    const chainScope = normalizeMarketChainScope(chainId)

    const limit =
        normalizedQuery.length > 0
            ? 20
            : chainScope === 'all'
                ? 2400
                : 100

    const cacheKey = getMarketTokenCacheKey({
        chainId: chainScope,
        query: normalizedQuery,
        limit,
    })

    const cachedEntry =
        readCacheEntry(cacheKey)

    const cacheTtlMs = normalizedQuery
        ? SEARCH_CACHE_TTL_MS
        : cachedEntry?.payload?.partial ||
            cachedEntry?.payload?.stale ||
            cachedEntry?.payload?.hardStale ||
            cachedEntry?.payload?.catalogUnavailable ||
            cachedEntry?.payload?.metadata?.providerPartial
          ? PARTIAL_CATALOG_CACHE_TTL_MS
          : CATALOG_CACHE_TTL_MS

    const cacheIsValid =
        cachedEntry &&
        Date.now() - cachedEntry.cachedAt <
        cacheTtlMs

    if (
        !normalizedQuery &&
        cacheIsValid &&
        !forceRefresh
    ) {
        return {
            ...cachedEntry.payload,
            browserCache: 'hit',
        }
    }

    const baseUrl =
        apiBaseUrl.replace(/\/+$/, '')

    const url = new URL(
        `${baseUrl}/v1/market-tokens`,
    )

    url.searchParams.set(
        'chainId',
        String(chainScope),
    )

    url.searchParams.set(
        'limit',
        String(limit),
    )

    if (normalizedQuery) {
        url.searchParams.set(
            'q',
            normalizedQuery,
        )
    }

    const requestKey = url.toString()
    let request = inFlightRequests.get(requestKey)
    if (!request) {
        request = fetch(requestKey, {
            method: 'GET',
            cache: forceRefresh ? 'no-cache' : 'default',
            headers: {
                accept: 'application/json',
                ...(cachedEntry?.etag
                    ? { 'if-none-match': cachedEntry.etag }
                    : {}),
            },
        }).finally(() => inFlightRequests.delete(requestKey))
        inFlightRequests.set(requestKey, request)
    }
    const sharedResponse = signal
        ? await Promise.race([
              request,
              new Promise((_, reject) => signal.addEventListener('abort', () => {
                  reject(new DOMException('The request was aborted.', 'AbortError'))
              }, { once: true })),
          ])
        : await request
    const response = sharedResponse.clone()

    if (response.status === 304) {
        if (!cachedEntry?.payload) {
            throw new Error('Backend returned 304 without a cached catalog')
        }
        writeCacheEntry(cacheKey, cachedEntry.payload, cachedEntry.etag)
        return {
            ...cachedEntry.payload,
            browserCache: 'revalidated',
        }
    }

    if (!response.ok) {
        if (cachedEntry?.payload?.tokens?.length > 0 && !normalizedQuery) {
            return {
                ...cachedEntry.payload,
                stale: true,
                partial: true,
                hardStale: true,
                browserCache: 'stale-fallback',
            }
        }
        throw new Error(
            `Token request failed with ${response.status}`,
        )
    }

    const payload = await response.json()

    if (payload.schemaVersion !== 6 || !Array.isArray(payload.tokens)) {
        throw new Error(
            'Backend returned an invalid token list',
        )
    }
    if (payload.count !== payload.tokens.length) {
        throw new Error('Backend returned an invalid ranked-token count')
    }
    if (!Array.isArray(payload.commonTokens) ||
        payload.commonCount !== payload.commonTokens.length) {
        throw new Error('Backend returned invalid common-token sections')
    }
    if (payload.tokens.some((token) => getCanonicalTokenIdentity(token) === null)) {
        throw new Error('Backend returned a malformed token identity')
    }
    for (const field of ['stale', 'partial', 'hardStale', 'catalogUnavailable']) {
        if (payload[field] !== undefined && typeof payload[field] !== 'boolean') {
            throw new Error('Backend returned invalid market catalog status')
        }
    }

    writeCacheEntry(cacheKey, payload, response.headers.get('etag'))

    return {
        ...payload,
        stale: payload.stale === true,
        partial: payload.partial === true,
        hardStale: payload.hardStale === true,
        catalogUnavailable: payload.catalogUnavailable === true,
        browserCache:
            normalizedQuery && cacheIsValid
                ? 'refreshed'
                : 'miss',
    }
}
