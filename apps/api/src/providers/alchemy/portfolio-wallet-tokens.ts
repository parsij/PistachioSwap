import { getApiConfig } from '../../config.js'
import { NATIVE_TOKEN_ADDRESS } from '../../lib/address.js'
import { ProviderError } from '../../lib/errors.js'
import { getAlchemyPortfolioNetwork } from './portfolio-networks.js'
import {
    fetchAlchemyPortfolioTokens,
    type AlchemyPortfolioBatchError,
    type AlchemyPortfolioToken,
} from './portfolio-tokens.js'
import {
    getWalletTokens,
    isCurrentWalletTokenRecord,
    WALLET_TOKEN_CLASSIFICATION_VERSION,
    type WalletToken,
    type WalletTokenInventory,
} from './wallet-tokens.js'

export type PortfolioWalletTokenResult = {
    classificationVersion: typeof WALLET_TOKEN_CLASSIFICATION_VERSION
    address: string
    source: 'alchemy-portfolio'
    tokens: WalletToken[]
    queriedChainIds: number[]
    successfulChainIds: number[]
    failedChainIds: number[]
    providerRejectedChainIds: number[]
    chainErrors: Record<string, string>
    batchErrors: AlchemyPortfolioBatchError[]
    partial: boolean
    stale: boolean
    diagnostics: {
        pageCount: number
        cacheStatus: 'hit' | 'miss' | 'stale'
        failureCode: string | null
    }
}

type CacheEntry = {
    value: Omit<PortfolioWalletTokenResult, 'diagnostics' | 'stale'>
    expiresAt: number
    staleUntil: number
    pageCount: number
    failureCode: string | null
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<CacheEntry>>()

function isCurrentCacheEntry(value: unknown): value is CacheEntry {
    if (value === null || typeof value !== 'object') return false
    const entry = value as Partial<CacheEntry>
    const portfolio = entry.value as Partial<CacheEntry['value']> | undefined
    return portfolio?.classificationVersion === WALLET_TOKEN_CLASSIFICATION_VERSION &&
        Array.isArray(portfolio.tokens) &&
        portfolio.tokens.every(isCurrentWalletTokenRecord) &&
        typeof entry.expiresAt === 'number' &&
        typeof entry.staleUntil === 'number'
}

function cacheKey(
    walletAddress: string,
    chainIds: readonly number[],
    includeZero: boolean,
) {
    const networks = [...chainIds]
        .map((chainId) => getAlchemyPortfolioNetwork(chainId))
        .filter((network) => network !== null)
        .sort()
    return [
        `v${WALLET_TOKEN_CLASSIFICATION_VERSION}`,
        walletAddress,
        networks.join(','),
        includeZero ? 'zero' : 'positive',
    ].join(':')
}

function touch(key: string, entry: CacheEntry) {
    cache.delete(key)
    cache.set(key, entry)
}

function trimCache(maximum: number) {
    while (cache.size > maximum) {
        const oldest = cache.keys().next().value
        if (typeof oldest !== 'string') break
        cache.delete(oldest)
    }
}

function inventoryForChain(
    chainId: number,
    tokens: readonly AlchemyPortfolioToken[],
): WalletTokenInventory {
    const balances = new Map<string, bigint>()
    const metadata = new Map()
    const prices = new Map<string, string>()
    let nativeBalance: bigint | null = null
    let nativePriceUSD: string | null = null

    for (const token of tokens) {
        if (token.chainId !== chainId) continue
        const balance = BigInt(token.rawBalance)
        if (token.isNative || token.address === NATIVE_TOKEN_ADDRESS) {
            nativeBalance = balance
            nativePriceUSD = token.marketPriceUSD
            continue
        }
        balances.set(token.address, balance)
        if (token.metadata) {
            metadata.set(token.address, {
                chainId,
                address: token.address,
                ...token.metadata,
            })
        }
        if (token.marketPriceUSD !== null) {
            prices.set(token.address, token.marketPriceUSD)
        }
    }

    return {
        balances,
        nativeBalance,
        pageCount: 0,
        metadata,
        prices,
        nativePriceUSD,
        source: 'alchemy-portfolio',
    }
}

function resultFromCache(
    entry: CacheEntry,
    cacheStatus: 'hit' | 'miss' | 'stale',
    stale: boolean,
    failureCode = entry.failureCode,
): PortfolioWalletTokenResult {
    return {
        ...entry.value,
        partial: stale || entry.value.partial,
        stale,
        diagnostics: {
            pageCount: entry.pageCount,
            cacheStatus,
            failureCode,
        },
    }
}

export function clearAlchemyPortfolioWalletCacheForTest() {
    cache.clear()
    inFlight.clear()
}

export function setAlchemyPortfolioWalletCacheForTest({
    walletAddress,
    chainIds,
    includeZero = false,
    entry,
}: {
    walletAddress: string
    chainIds: readonly number[]
    includeZero?: boolean
    entry: unknown
}) {
    cache.set(
        cacheKey(walletAddress.toLowerCase(), chainIds, includeZero),
        entry as CacheEntry,
    )
}

export function hasStaleAlchemyPortfolioWalletCache({
    walletAddress,
    chainIds,
    includeZero = false,
}: {
    walletAddress: string
    chainIds: readonly number[]
    includeZero?: boolean
}) {
    const key = cacheKey(walletAddress.toLowerCase(), chainIds, includeZero)
    const entry = cache.get(key)
    return Boolean(
        entry &&
        isCurrentCacheEntry(entry) &&
        entry.staleUntil > Date.now(),
    )
}

export async function getAlchemyPortfolioWalletTokens({
    walletAddress,
    chainIds,
    includeZero = false,
    signal,
    fetchImpl = fetch,
}: {
    walletAddress: string
    chainIds: readonly number[]
    includeZero?: boolean
    signal?: AbortSignal
    fetchImpl?: typeof fetch
}): Promise<PortfolioWalletTokenResult> {
    const config = getApiConfig()
    const normalizedChainIds = [...new Set(chainIds.map(Number))]
        .filter(Number.isSafeInteger)
        .sort((left, right) => left - right)
    const normalizedWallet = walletAddress.toLowerCase()
    const key = cacheKey(normalizedWallet, normalizedChainIds, includeZero)
    const now = Date.now()
    const cacheCandidate = cache.get(key)
    const cached = cacheCandidate && isCurrentCacheEntry(cacheCandidate)
        ? cacheCandidate
        : undefined
    if (cacheCandidate && !cached) cache.delete(key)
    if (cached && cached.expiresAt > now) {
        touch(key, cached)
        return resultFromCache(cached, 'hit', false)
    }

    let request = inFlight.get(key)
    if (!request) {
        request = (async () => {
            const portfolio = await fetchAlchemyPortfolioTokens({
                walletAddress: normalizedWallet,
                chainIds: normalizedChainIds,
                includeZero,
                signal,
            }, {
                fetchImpl,
                config: {
                    apiKey: config.alchemy.apiKey,
                    timeoutMs: config.alchemy.portfolio.timeoutMs,
                    maxPages: config.alchemy.portfolio.maxPages,
                },
            })
            const providerSuccessfulChainIds = portfolio.successfulChainIds
            const chainResults = await Promise.allSettled(
                providerSuccessfulChainIds.map(async (chainId) => ({
                    chainId,
                    tokens: await getWalletTokens({
                        chainId,
                        walletAddress: portfolio.walletAddress,
                        includeZero,
                        signal,
                        inventory: inventoryForChain(chainId, portfolio.tokens),
                    }),
                })),
            )
            const successfulChainIds: number[] = []
            const failedChainIds = [...portfolio.failedChainIds]
            const providerRejectedChainIds = [
                ...portfolio.providerRejectedChainIds,
            ]
            const tokens: WalletToken[] = []
            const chainErrors: Record<string, string> = Object.fromEntries(
                [
                    ...portfolio.failedChainIds.map((chainId) => [
                        String(chainId),
                        'This network balance could not be refreshed.',
                    ] as const),
                    ...providerRejectedChainIds.map((chainId) => [
                        String(chainId),
                        'This network is not currently accepted by the wallet balance provider.',
                    ] as const),
                ],
            )
            for (let index = 0; index < chainResults.length; index += 1) {
                const chainId = providerSuccessfulChainIds[index]
                const result = chainResults[index]
                if (result.status === 'fulfilled') {
                    successfulChainIds.push(chainId)
                    tokens.push(...result.value.tokens)
                } else {
                    failedChainIds.push(chainId)
                    chainErrors[String(chainId)] =
                        'This network balance could not be refreshed.'
                }
            }
            if (successfulChainIds.length === 0 && normalizedChainIds.length > 0) {
                throw new ProviderError({
                    code: 'WALLET_TOKEN_CLASSIFICATION_UNAVAILABLE',
                    message: 'Wallet balances could not be loaded.',
                    statusCode: 503,
                    retryable: true,
                    outcome: 'upstream',
                })
            }

            const fetchedAt = Date.now()
            const entry: CacheEntry = {
                value: {
                    classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
                    address: portfolio.walletAddress,
                    source: 'alchemy-portfolio',
                    tokens,
                    queriedChainIds: portfolio.queriedChainIds,
                    successfulChainIds: successfulChainIds.sort(
                        (left, right) => left - right,
                    ),
                    failedChainIds: [...new Set(failedChainIds)].sort(
                        (left, right) => left - right,
                    ),
                    providerRejectedChainIds: [
                        ...new Set(providerRejectedChainIds),
                    ].sort((left, right) => left - right),
                    chainErrors,
                    batchErrors: portfolio.batchErrors,
                    partial: portfolio.partial || Object.keys(chainErrors).length > 0,
                },
                expiresAt: fetchedAt + config.alchemy.portfolio.cacheTtlMs,
                staleUntil: fetchedAt + Math.max(
                    config.alchemy.portfolio.cacheTtlMs,
                    config.alchemy.portfolio.staleTtlMs,
                ),
                pageCount: portfolio.pageCount,
                failureCode: portfolio.failureCode,
            }
            touch(key, entry)
            trimCache(config.alchemy.portfolio.maxCacheEntries)
            return entry
        })().finally(() => {
            inFlight.delete(key)
        })
        inFlight.set(key, request)
    }

    try {
        const entry = await request
        return resultFromCache(entry, 'miss', false)
    } catch (error) {
        if (
            error instanceof ProviderError &&
            error.retryable &&
            cached &&
            cached.staleUntil > Date.now()
        ) {
            touch(key, cached)
            return resultFromCache(cached, 'stale', true, error.code)
        }
        throw error
    }
}
