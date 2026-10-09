import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
    NATIVE_TOKEN_ADDRESS,
    createTokenId,
    normalizeAddress,
} from '../../lib/address.js'
import {
    getTokenDiscoveryChain,
} from '../../token-discovery/registry.js'
import {
    loadShapeShiftAssetCatalog,
    type ShapeShiftAssetCatalog,
    type ShapeShiftCatalogToken,
} from '../../token-discovery/shapeshift-asset-catalog.js'
import type { WalletToken } from '../alchemy/wallet-tokens.js'
import {
    fetchTokenMarkets,
    type TokenMarketBatchResult,
} from './token-markets.js'

const PRICE_CACHE_SCHEMA_VERSION = 1 as const
const DEFAULT_PRICE_TTL_MS = 30 * 60_000
const DEFAULT_NEGATIVE_PRICE_TTL_MS = 5 * 60_000
const DEFAULT_MAX_CACHE_ENTRIES = 20_000
const SAVE_DEBOUNCE_MS = 1_000
const MAX_ENTRY_AGE_MS = 30 * 24 * 60 * 60_000

export const DEFAULT_DEXSCREENER_WALLET_PRICE_CACHE_PATH = fileURLToPath(
    new URL('../../../data/dexscreener-wallet-price-cache.v1.json', import.meta.url),
)

export type DexScreenerWalletPriceCacheEntry = {
    chainId: number
    address: string
    queryAddress: string
    priceUSD: string | null
    liquidityUsd: number | null
    fetchedAt: number
    expiresAt: number
}

type PersistedPriceCache = {
    schemaVersion: typeof PRICE_CACHE_SCHEMA_VERSION
    savedAt: string
    entries: Record<string, {
        chainId: number
        address: string
        queryAddress: string
        priceUSD: string | null
        liquidityUsd: number | null
        fetchedAt: string
        expiresAt: string
    }>
}

type TrustedWalletToken = {
    token: WalletToken
    catalogToken: ShapeShiftCatalogToken
    identity: string
    queryAddress: string | null
}

type PriceCacheDependencies = {
    path?: string
    now?: () => number
    fetchMarkets?: (
        addresses: string[],
        signal?: AbortSignal,
        chainId?: number,
    ) => Promise<TokenMarketBatchResult>
    loadCatalog?: typeof loadShapeShiftAssetCatalog
    priceTtlMs?: number
    negativePriceTtlMs?: number
    maxEntries?: number
}

function positiveInteger(value: unknown, fallback: number) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function configuredPath(override?: string) {
    return override ?? (
        process.env.DEXSCREENER_WALLET_PRICE_CACHE_PATH?.trim() ||
        DEFAULT_DEXSCREENER_WALLET_PRICE_CACHE_PATH
    )
}

function configuredPriceTtlMs(override?: number) {
    return positiveInteger(
        override ?? process.env.DEXSCREENER_WALLET_PRICE_TTL_MS,
        DEFAULT_PRICE_TTL_MS,
    )
}

function configuredNegativePriceTtlMs(override?: number) {
    return positiveInteger(
        override ?? process.env.DEXSCREENER_WALLET_NEGATIVE_PRICE_TTL_MS,
        DEFAULT_NEGATIVE_PRICE_TTL_MS,
    )
}

function validPrice(value: unknown): value is string {
    return typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && /[1-9]/.test(value)
}

function validLiquidity(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function multiplyDecimal(left: string, right: string) {
    const leftMatch = /^(\d+)(?:\.(\d+))?$/.exec(left)
    const rightMatch = /^(\d+)(?:\.(\d+))?$/.exec(right)
    if (!leftMatch || !rightMatch) return null
    const leftFraction = leftMatch[2] ?? ''
    const rightFraction = rightMatch[2] ?? ''
    const scale = leftFraction.length + rightFraction.length
    const product = BigInt(`${leftMatch[1]}${leftFraction}`) *
        BigInt(`${rightMatch[1]}${rightFraction}`)
    if (scale === 0) return product.toString()
    const padded = product.toString().padStart(scale + 1, '0')
    const whole = padded.slice(0, -scale)
    const fraction = padded.slice(-scale).replace(/0+$/u, '')
    return fraction ? `${whole}.${fraction}` : whole
}

function uniqueStrings(values: Array<string | null | undefined>) {
    return values.filter((value, index, all): value is string =>
        typeof value === 'string' && value.length > 0 && all.indexOf(value) === index)
}

function addReason(values: string[] | undefined, reason: string) {
    return [...new Set([...(values ?? []), reason])]
}

function parseEntry(value: unknown): DexScreenerWalletPriceCacheEntry | null {
    if (typeof value !== 'object' || value === null) return null
    const candidate = value as Record<string, unknown>
    const chainId = Number(candidate.chainId)
    const address = normalizeAddress(candidate.address)
    const queryAddress = normalizeAddress(candidate.queryAddress)
    const fetchedAt = Date.parse(String(candidate.fetchedAt ?? ''))
    const expiresAt = Date.parse(String(candidate.expiresAt ?? ''))
    const priceUSD = candidate.priceUSD === null
        ? null
        : validPrice(candidate.priceUSD) ? candidate.priceUSD : undefined
    const liquidityUsd = candidate.liquidityUsd === null
        ? null
        : validLiquidity(candidate.liquidityUsd) ? candidate.liquidityUsd : undefined
    if (
        !Number.isSafeInteger(chainId) ||
        !address ||
        !queryAddress ||
        !Number.isFinite(fetchedAt) ||
        !Number.isFinite(expiresAt) ||
        priceUSD === undefined ||
        liquidityUsd === undefined
    ) return null
    return {
        chainId,
        address,
        queryAddress,
        priceUSD,
        liquidityUsd,
        fetchedAt,
        expiresAt,
    }
}

function serializeEntry(entry: DexScreenerWalletPriceCacheEntry) {
    return {
        chainId: entry.chainId,
        address: entry.address,
        queryAddress: entry.queryAddress,
        priceUSD: entry.priceUSD,
        liquidityUsd: entry.liquidityUsd,
        fetchedAt: new Date(entry.fetchedAt).toISOString(),
        expiresAt: new Date(entry.expiresAt).toISOString(),
    }
}

function stripUntrustedPrice(token: WalletToken): WalletToken {
    return {
        ...token,
        priceUSD: null,
        trustedPriceUSD: null,
        marketPriceUSD: null,
        valueUSD: null,
        estimatedSellValueUsd: null,
        priceConfidence: 'unknown',
        includeInPortfolioValue: false,
    }
}

function promoteShapeShiftToken(
    trusted: TrustedWalletToken,
    entry: DexScreenerWalletPriceCacheEntry | undefined,
): WalletToken {
    const { token, catalogToken } = trusted
    const explicitlyBlocked = token.classificationTier === 'blocked' ||
        token.securityStatus === 'blocked'
    const priceUSD = entry?.priceUSD ?? null
    const balance = String(token.formattedBalance ?? token.balance ?? '')
    const valueUSD = priceUSD ? multiplyDecimal(balance, priceUSD) : null
    const reason = 'shapeshift-asset-catalog'
    const isNative = token.isNative === true || token.address === NATIVE_TOKEN_ADDRESS
    const logoCandidates = uniqueStrings([
        catalogToken.icon,
        ...(token.logoCandidates ?? []),
        token.logoURI,
        '/icons/token-fallback.svg',
    ])

    return {
        ...token,
        name: catalogToken.name,
        symbol: catalogToken.symbol,
        decimals: catalogToken.decimals,
        logoURI: logoCandidates[0] ?? null,
        logoCandidates,
        logoSource: 'curated',
        priceUSD,
        trustedPriceUSD: priceUSD,
        marketPriceUSD: priceUSD,
        valueUSD: explicitlyBlocked ? null : valueUSD,
        priceConfidence: priceUSD ? 'trusted' : 'unknown',
        liquidityUsd: entry?.liquidityUsd ?? 0,
        trustedLiquidityUsd: entry?.liquidityUsd ?? null,
        largestTrustedPoolLiquidityUsd: entry?.liquidityUsd ?? null,
        estimatedSellValueUsd: explicitlyBlocked ? null : valueUSD,
        classificationTier: explicitlyBlocked
            ? 'blocked'
            : isNative ? 'core' : 'established',
        classificationReasons: addReason(token.classificationReasons, reason),
        recognitionStatus: explicitlyBlocked
            ? token.recognitionStatus
            : isNative ? 'established' : 'recognized',
        recognitionReasons: addReason(token.recognitionReasons, reason),
        verificationStatus: explicitlyBlocked
            ? token.verificationStatus
            : isNative ? 'established' : 'recognized',
        verificationReasons: addReason(token.verificationReasons, reason),
        spamStatus: explicitlyBlocked ? token.spamStatus : 'clean',
        possibleSpam: explicitlyBlocked ? token.possibleSpam : false,
        verifiedContract: isNative ? null : true,
        spamReasons: explicitlyBlocked
            ? token.spamReasons
            : addReason(token.spamReasons, reason),
        securityStatus: explicitlyBlocked ? 'blocked' : 'trusted',
        securityReasons: explicitlyBlocked
            ? token.securityReasons
            : addReason(token.securityReasons, reason),
        visibility: explicitlyBlocked ? 'hidden' : 'primary',
        visibilityReasons: explicitlyBlocked
            ? token.visibilityReasons
            : addReason(token.visibilityReasons, reason),
        includeInPortfolioValue: !explicitlyBlocked && valueUSD !== null,
    }
}

export function createDexScreenerWalletPriceCache(
    dependencies: PriceCacheDependencies = {},
) {
    const now = dependencies.now ?? Date.now
    const fetchMarkets = dependencies.fetchMarkets ?? fetchTokenMarkets
    const loadCatalog = dependencies.loadCatalog ?? loadShapeShiftAssetCatalog
    const priceTtlMs = configuredPriceTtlMs(dependencies.priceTtlMs)
    const negativePriceTtlMs = configuredNegativePriceTtlMs(
        dependencies.negativePriceTtlMs,
    )
    const maxEntries = positiveInteger(
        dependencies.maxEntries,
        DEFAULT_MAX_CACHE_ENTRIES,
    )
    const entries = new Map<string, DexScreenerWalletPriceCacheEntry>()
    let activePath: string | null = null
    let hydrated = false
    let dirty = false
    let hydratePromise: Promise<{ loaded: number; ignored: number }> | null = null
    let flushPromise: Promise<void> = Promise.resolve()
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    let catalogReference: ShapeShiftAssetCatalog | null = null
    let catalogByIdentity = new Map<string, ShapeShiftCatalogToken>()

    function cachePath() {
        return configuredPath(dependencies.path)
    }

    function ensurePathState() {
        const resolved = cachePath()
        if (activePath === resolved) return resolved
        activePath = resolved
        hydrated = false
        dirty = false
        entries.clear()
        catalogReference = null
        catalogByIdentity = new Map()
        return resolved
    }

    function trimEntries() {
        const cutoff = now() - MAX_ENTRY_AGE_MS
        for (const [key, entry] of entries) {
            if (entry.fetchedAt < cutoff) entries.delete(key)
        }
        if (entries.size <= maxEntries) return
        const oldest = [...entries.entries()].sort(
            (left, right) => left[1].fetchedAt - right[1].fetchedAt,
        )
        for (const [key] of oldest.slice(0, entries.size - maxEntries)) {
            entries.delete(key)
        }
    }

    async function hydrate() {
        ensurePathState()
        if (hydrated) return { loaded: entries.size, ignored: 0 }
        if (hydratePromise) return hydratePromise
        hydratePromise = (async () => {
            let ignored = 0
            try {
                const parsed = JSON.parse(
                    await readFile(activePath!, 'utf8'),
                ) as Partial<PersistedPriceCache>
                if (
                    parsed.schemaVersion !== PRICE_CACHE_SCHEMA_VERSION ||
                    typeof parsed.entries !== 'object' ||
                    parsed.entries === null
                ) {
                    hydrated = true
                    return { loaded: 0, ignored: 1 }
                }
                for (const [key, value] of Object.entries(parsed.entries)) {
                    const entry = parseEntry(value)
                    const expectedKey = entry
                        ? createTokenId(entry.chainId, entry.address)
                        : null
                    if (!entry || key !== expectedKey) {
                        ignored += 1
                        continue
                    }
                    entries.set(key, entry)
                }
                trimEntries()
            } catch (error) {
                const code = typeof error === 'object' && error !== null &&
                    'code' in error ? String(error.code) : ''
                if (code !== 'ENOENT') ignored += 1
            }
            hydrated = true
            return { loaded: entries.size, ignored }
        })().finally(() => {
            hydratePromise = null
        })
        return hydratePromise
    }

    async function shapeShiftIndex() {
        const loaded = await loadCatalog()
        if (!loaded.catalog) {
            catalogReference = null
            catalogByIdentity = new Map()
            return catalogByIdentity
        }
        if (catalogReference === loaded.catalog) return catalogByIdentity
        catalogReference = loaded.catalog
        catalogByIdentity = new Map(
            loaded.catalog.ids.map((assetId) => {
                const token = loaded.catalog!.byId[assetId]
                return [createTokenId(token.chainId, token.address), token] as const
            }),
        )
        return catalogByIdentity
    }

    function scheduleFlush() {
        if (process.env.NODE_ENV === 'test' || saveTimer !== null) return
        saveTimer = setTimeout(() => {
            saveTimer = null
            void flush().catch(() => undefined)
        }, SAVE_DEBOUNCE_MS)
        saveTimer.unref()
    }

    function setEntry(entry: DexScreenerWalletPriceCacheEntry) {
        entries.set(createTokenId(entry.chainId, entry.address), entry)
        trimEntries()
        dirty = true
        scheduleFlush()
    }

    async function refreshChain(
        chainId: number,
        trustedTokens: TrustedWalletToken[],
        signal?: AbortSignal,
    ) {
        const queryAddresses = [...new Set(
            trustedTokens.flatMap((item) => item.queryAddress ? [item.queryAddress] : []),
        )]
        if (queryAddresses.length === 0) return
        let result: TokenMarketBatchResult
        try {
            result = await fetchMarkets(queryAddresses, signal, chainId)
        } catch {
            return
        }
        const refreshedAt = now()
        for (const trusted of trustedTokens) {
            if (!trusted.queryAddress) continue
            const market = result.markets.get(trusted.queryAddress)
            if (!market && result.partial) continue
            const priceUSD = validPrice(market?.priceUSD) ? market.priceUSD : null
            const liquidityUsd = validLiquidity(market?.liquidityUsd)
                ? market.liquidityUsd
                : null
            const previous = entries.get(trusted.identity)
            // Empty/missing market data must not erase a measured price. Retry
            // after the negative TTL while retaining its original observation time.
            if (!priceUSD && previous?.priceUSD) {
                setEntry({ ...previous, expiresAt: refreshedAt + negativePriceTtlMs })
                continue
            }
            setEntry({
                chainId,
                address: trusted.token.address,
                queryAddress: trusted.queryAddress,
                priceUSD,
                liquidityUsd,
                fetchedAt: refreshedAt,
                expiresAt: refreshedAt + (priceUSD
                    ? priceTtlMs
                    : negativePriceTtlMs),
            })
        }
    }

    async function enrichWalletTokens(
        tokens: WalletToken[],
        signal?: AbortSignal,
    ): Promise<WalletToken[]> {
        await hydrate()
        const catalog = await shapeShiftIndex()
        if (catalog.size === 0) return tokens.map(stripUntrustedPrice)

        const trustedByIndex = new Map<number, TrustedWalletToken>()
        for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
            const token = tokens[tokenIndex]
            const address = normalizeAddress(token.address)
            if (!address) continue
            const identity = createTokenId(Number(token.chainId), address)
            const catalogToken = catalog.get(identity)
            if (!catalogToken) continue
            const chain = getTokenDiscoveryChain(Number(token.chainId))
            trustedByIndex.set(tokenIndex, {
                token: { ...token, address },
                catalogToken,
                identity,
                queryAddress: chain?.active && chain.capabilities.dexScreener
                    ? catalogToken.isNative
                        ? chain.wrappedNative.address
                        : address
                    : null,
            })
        }

        const currentTime = now()
        const staleByChain = new Map<number, TrustedWalletToken[]>()
        for (const trusted of trustedByIndex.values()) {
            if (!trusted.queryAddress) continue
            const entry = entries.get(trusted.identity)
            if (entry && entry.expiresAt > currentTime) continue
            const list = staleByChain.get(trusted.token.chainId) ?? []
            list.push(trusted)
            staleByChain.set(trusted.token.chainId, list)
        }

        const groups = [...staleByChain.entries()]
        let cursor = 0
        const workers = Array.from(
            { length: Math.min(4, groups.length) },
            async () => {
                while (cursor < groups.length) {
                    const current = cursor
                    cursor += 1
                    const [chainId, trusted] = groups[current]
                    await refreshChain(chainId, trusted, signal)
                }
            },
        )
        await Promise.all(workers)

        return tokens.map((token, tokenIndex) => {
            const trusted = trustedByIndex.get(tokenIndex)
            if (!trusted) return stripUntrustedPrice(token)
            return promoteShapeShiftToken(
                trusted,
                entries.get(trusted.identity),
            )
        })
    }

    async function flush() {
        const path = ensurePathState()
        await hydrate()
        if (saveTimer !== null) {
            clearTimeout(saveTimer)
            saveTimer = null
        }
        if (!dirty) return flushPromise
        const payload: PersistedPriceCache = {
            schemaVersion: PRICE_CACHE_SCHEMA_VERSION,
            savedAt: new Date(now()).toISOString(),
            entries: Object.fromEntries(
                [...entries.entries()].map(([key, entry]) => [key, serializeEntry(entry)]),
            ),
        }
        flushPromise = flushPromise.catch(() => undefined).then(async () => {
            await mkdir(dirname(path), { recursive: true })
            const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`
            await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`)
            await rename(temporaryPath, path)
            dirty = false
        })
        return flushPromise
    }

    function resetForTest() {
        if (saveTimer !== null) clearTimeout(saveTimer)
        saveTimer = null
        entries.clear()
        hydrated = false
        dirty = false
        hydratePromise = null
        flushPromise = Promise.resolve()
        activePath = null
        catalogReference = null
        catalogByIdentity = new Map()
    }

    return {
        hydrate,
        enrichWalletTokens,
        flush,
        resetForTest,
        get size() {
            return entries.size
        },
    }
}

export const dexScreenerWalletPriceCache = createDexScreenerWalletPriceCache()
