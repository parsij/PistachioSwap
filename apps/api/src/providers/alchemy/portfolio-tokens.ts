import { createHash } from 'node:crypto'

import { ProviderError } from '../../lib/errors.js'
import {
    NATIVE_TOKEN_ADDRESS,
    normalizeAddress,
} from '../../lib/address.js'
import {
    isRecord,
    validateRemoteImageUrl,
} from '../../lib/http.js'
import {
    ALCHEMY_PORTFOLIO_MAX_NETWORKS_PER_REQUEST,
    chunkAlchemyPortfolioNetworks,
    getAlchemyPortfolioNetwork,
    getChainIdForAlchemyPortfolioNetwork,
    getUnsupportedPortfolioChainIds,
    type AlchemyPortfolioNetwork,
} from './portfolio-networks.js'

export const ALCHEMY_PORTFOLIO_BATCH_CONCURRENCY = 2 as const
export const ALCHEMY_PORTFOLIO_SUPPORT_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const ALCHEMY_PORTFOLIO_SUPPORT_CACHE_MAX_ENTRIES = 200

export type AlchemyPortfolioToken = {
    chainId: number
    address: string
    isNative: boolean
    rawBalance: string
    metadata: {
        decimals: number
        logoURI: string | null
        name: string
        symbol: string
    } | null
    marketPriceUSD: string | null
}

export type AlchemyPortfolioBatchError = {
    batchIndex: number
    chainIds: number[]
    code: string
}

export type AlchemyPortfolioBatchResult = {
    batchIndex: number
    chainIds: number[]
    networks: AlchemyPortfolioNetwork[]
    tokens: AlchemyPortfolioToken[]
    pageCount: number
    partial: boolean
    failureCode: string | null
    skippedRecordCount: number
}

export type AlchemyPortfolioTokensResult = {
    walletAddress: string
    requestedChainIds: number[]
    supportedChainIds: number[]
    unsupportedChainIds: number[]
    queriedChainIds: number[]
    successfulChainIds: number[]
    failedChainIds: number[]
    providerRejectedChainIds: number[]
    batchErrors: AlchemyPortfolioBatchError[]
    batches: AlchemyPortfolioBatchResult[]
    tokens: AlchemyPortfolioToken[]
    pageCount: number
    partial: boolean
    failureCode: string | null
    skippedRecordCount: number
}

export type AlchemyPortfolioProviderConfig = {
    apiKey: string | null
    timeoutMs: number
    maxPages: number
}

type Dependencies = {
    fetchImpl?: typeof fetch
    config: AlchemyPortfolioProviderConfig
}

type SupportCacheEntry = {
    outcome: 'supported' | 'provider-rejected'
    expiresAt: number
}

const supportCache = new Map<string, SupportCacheEntry>()

function supportCacheConfigurationId(apiKey: string) {
    return createHash('sha256').update(apiKey).digest('hex')
}

function supportCacheKey(configurationId: string, network: string) {
    return `${configurationId}:${network}`
}

function readSupportCache(configurationId: string, network: string) {
    const key = supportCacheKey(configurationId, network)
    const entry = supportCache.get(key)
    if (!entry || entry.expiresAt <= Date.now()) {
        supportCache.delete(key)
        return null
    }
    supportCache.delete(key)
    supportCache.set(key, entry)
    return entry.outcome
}

function writeSupportCache(
    configurationId: string,
    network: AlchemyPortfolioNetwork,
    outcome: SupportCacheEntry['outcome'],
) {
    const key = supportCacheKey(configurationId, network)
    supportCache.delete(key)
    supportCache.set(key, {
        outcome,
        expiresAt: Date.now() + ALCHEMY_PORTFOLIO_SUPPORT_CACHE_TTL_MS,
    })
    while (supportCache.size > ALCHEMY_PORTFOLIO_SUPPORT_CACHE_MAX_ENTRIES) {
        const oldest = supportCache.keys().next().value
        if (typeof oldest !== 'string') break
        supportCache.delete(oldest)
    }
}

export function clearAlchemyPortfolioSupportCacheForTest() {
    supportCache.clear()
}

const DECIMAL_INTEGER = /^(?:0|[1-9]\d*)$/
const HEX_INTEGER = /^0x[0-9a-fA-F]+$/
const DECIMAL_PRICE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/

function parseRawBalance(value: unknown) {
    if (typeof value !== 'string') return null
    const text = value.trim()
    if (!DECIMAL_INTEGER.test(text) && !HEX_INTEGER.test(text)) return null
    try {
        return BigInt(text)
    } catch {
        return null
    }
}

function normalizeMetadata(value: unknown) {
    if (!isRecord(value)) return null
    const decimals = value.decimals
    const name = typeof value.name === 'string' ? value.name.trim() : ''
    const symbol = typeof value.symbol === 'string' ? value.symbol.trim() : ''
    if (
        !Number.isInteger(decimals) ||
        Number(decimals) < 0 ||
        Number(decimals) > 255 ||
        !name ||
        name.length > 120 ||
        !symbol ||
        symbol.length > 32
    ) return null

    return {
        decimals: Number(decimals),
        logoURI: validateRemoteImageUrl(value.logo),
        name,
        symbol,
    }
}

function normalizeUsdPrice(value: unknown) {
    if (!Array.isArray(value)) return null
    const usd = value.find((candidate) =>
        isRecord(candidate) &&
        String(candidate.currency).toLowerCase() === 'usd',
    )
    if (!isRecord(usd) || typeof usd.value !== 'string') return null
    const price = usd.value.trim()
    return DECIMAL_PRICE.test(price) ? price : null
}

function metadataScore(token: AlchemyPortfolioToken) {
    return token.metadata ? 4 + Number(token.metadata.logoURI !== null) : 0
}

function mergeDuplicate(
    current: AlchemyPortfolioToken | undefined,
    candidate: AlchemyPortfolioToken,
) {
    if (!current) return candidate
    const currentBalance = BigInt(current.rawBalance)
    const candidateBalance = BigInt(candidate.rawBalance)
    const balanceSource = currentBalance === 0n && candidateBalance > 0n
        ? candidate
        : current
    const metadataSource = metadataScore(candidate) > metadataScore(current)
        ? candidate
        : current
    return {
        ...balanceSource,
        metadata: metadataSource.metadata,
        marketPriceUSD: current.marketPriceUSD ?? candidate.marketPriceUSD,
    }
}

function createProviderError(status: number) {
    if (status === 400) {
        return new ProviderError({
            code: 'ALCHEMY_PORTFOLIO_REQUEST_INVALID',
            message: 'The wallet portfolio provider rejected the request.',
            outcome: 'validation',
            upstreamStatus: status,
        })
    }
    if (status === 401 || status === 403) {
        return new ProviderError({
            code: 'ALCHEMY_PORTFOLIO_AUTH_FAILED',
            message: 'The wallet portfolio provider authentication failed.',
            statusCode: 503,
            outcome: 'authentication',
            upstreamStatus: status,
        })
    }
    if (status === 429) {
        return new ProviderError({
            code: 'ALCHEMY_PORTFOLIO_RATE_LIMITED',
            message: 'Wallet balances are temporarily unavailable.',
            statusCode: 503,
            retryable: true,
            outcome: 'rate-limit',
            upstreamStatus: status,
        })
    }
    return new ProviderError({
        code: 'ALCHEMY_PORTFOLIO_UNAVAILABLE',
        message: 'Wallet balances are temporarily unavailable.',
        statusCode: 503,
        retryable: status >= 500,
        outcome: 'upstream',
        upstreamStatus: status,
    })
}

async function fetchPage({
    url,
    body,
    signal,
    timeoutMs,
    fetchImpl,
}: {
    url: URL
    body: unknown
    signal?: AbortSignal
    timeoutMs: number
    fetchImpl: typeof fetch
}) {
    const timeoutController = new AbortController()
    const timeout = setTimeout(
        () => timeoutController.abort(new DOMException('Timed out', 'TimeoutError')),
        timeoutMs,
    )
    const requestSignal = signal
        ? AbortSignal.any([signal, timeoutController.signal])
        : timeoutController.signal

    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: requestSignal,
        })
        if (!response.ok) throw createProviderError(response.status)
        try {
            return await response.json()
        } catch (error) {
            throw new ProviderError({
                code: 'ALCHEMY_PORTFOLIO_RESPONSE_INVALID',
                message: 'The wallet portfolio provider returned an invalid response.',
                retryable: true,
                outcome: 'upstream',
                cause: error,
            })
        }
    } catch (error) {
        if (error instanceof ProviderError) throw error
        if (signal?.aborted) {
            throw new ProviderError({
                code: 'ALCHEMY_PORTFOLIO_REQUEST_ABORTED',
                message: 'The wallet portfolio request was aborted.',
                outcome: 'upstream',
                cause: signal.reason,
            })
        }
        const timedOut = timeoutController.signal.aborted
        throw new ProviderError({
            code: timedOut
                ? 'ALCHEMY_PORTFOLIO_TIMEOUT'
                : 'ALCHEMY_PORTFOLIO_UNAVAILABLE',
            message: 'Wallet balances are temporarily unavailable.',
            statusCode: 503,
            retryable: true,
            outcome: timedOut ? 'timeout' : 'upstream',
            cause: error,
        })
    } finally {
        clearTimeout(timeout)
    }
}

export async function fetchAlchemyPortfolioNetworkBatch({
    walletAddress,
    networks,
    includeZero = false,
    signal,
    batchIndex = 0,
}: {
    walletAddress: string
    networks: readonly string[]
    includeZero?: boolean
    signal?: AbortSignal
    batchIndex?: number
}, {
    fetchImpl = fetch,
    config,
}: Dependencies): Promise<AlchemyPortfolioBatchResult> {
    const wallet = normalizeAddress(walletAddress)
    if (!wallet) {
        throw new ProviderError({
            code: 'INVALID_WALLET_ADDRESS',
            message: 'A valid wallet address is required.',
            statusCode: 400,
            outcome: 'validation',
        })
    }
    if (!config.apiKey) {
        throw new ProviderError({
            code: 'ALCHEMY_PORTFOLIO_CONFIGURATION_ERROR',
            message: 'The wallet portfolio provider is not configured correctly.',
            statusCode: 503,
            outcome: 'configuration',
        })
    }

    let networkBatch: AlchemyPortfolioNetwork[]
    try {
        const batches = chunkAlchemyPortfolioNetworks(networks)
        if (batches.length !== 1 || batches[0].length > ALCHEMY_PORTFOLIO_MAX_NETWORKS_PER_REQUEST) {
            throw new Error('A Portfolio request must contain one network batch.')
        }
        networkBatch = batches[0]
    } catch (error) {
        throw new ProviderError({
            code: 'ALCHEMY_PORTFOLIO_REQUEST_INVALID',
            message: 'The wallet portfolio provider request is invalid.',
            outcome: 'validation',
            cause: error,
        })
    }
    const chainIds = networkBatch.map((network) =>
        getChainIdForAlchemyPortfolioNetwork(network)!,
    )
    const allowedNetworks = new Set(networkBatch)
    const url = new URL(
        `https://api.g.alchemy.com/data/v1/${encodeURIComponent(config.apiKey)}/assets/tokens/by-address`,
    )
    const tokens = new Map<string, AlchemyPortfolioToken>()
    const seenPageKeys = new Set<string>()
    let pageKey: string | null = null
    let pageCount = 0
    let skippedRecordCount = 0
    let partial = false
    let failureCode: string | null = null

    do {
        const payload = await fetchPage({
            url,
            body: {
                addresses: [{ address: wallet, networks: networkBatch }],
                withMetadata: true,
                withPrices: true,
                includeNativeTokens: true,
                includeErc20Tokens: true,
                ...(pageKey ? { pageKey } : {}),
            },
            signal,
            timeoutMs: config.timeoutMs,
            fetchImpl,
        })
        pageCount += 1
        const data = isRecord(payload) && isRecord(payload.data)
            ? payload.data
            : null
        if (!data || !Array.isArray(data.tokens)) {
            throw new ProviderError({
                code: 'ALCHEMY_PORTFOLIO_RESPONSE_INVALID',
                message: 'The wallet portfolio provider returned an invalid response.',
                retryable: true,
                outcome: 'upstream',
            })
        }

        for (const value of data.tokens) {
            if (!isRecord(value)) {
                skippedRecordCount += 1
                partial = true
                continue
            }
            const returnedNetwork = typeof value.network === 'string'
                ? value.network
                : ''
            const chainId = allowedNetworks.has(returnedNetwork as AlchemyPortfolioNetwork)
                ? getChainIdForAlchemyPortfolioNetwork(returnedNetwork)
                : null
            const responseWallet = normalizeAddress(value.address)
            const balance = parseRawBalance(value.tokenBalance)
            if (chainId === null || responseWallet !== wallet || balance === null) {
                skippedRecordCount += 1
                partial = true
                continue
            }
            if (!includeZero && balance === 0n) continue

            const tokenAddress = value.tokenAddress == null
                ? NATIVE_TOKEN_ADDRESS
                : normalizeAddress(value.tokenAddress)
            if (!tokenAddress) {
                skippedRecordCount += 1
                partial = true
                continue
            }
            const candidate: AlchemyPortfolioToken = {
                chainId,
                address: tokenAddress,
                isNative: tokenAddress === NATIVE_TOKEN_ADDRESS,
                rawBalance: balance.toString(),
                metadata: normalizeMetadata(value.tokenMetadata),
                marketPriceUSD: normalizeUsdPrice(value.tokenPrices),
            }
            const key = `${chainId}:${tokenAddress}`
            tokens.set(key, mergeDuplicate(tokens.get(key), candidate))
        }

        const nextPageKey = typeof data.pageKey === 'string' && data.pageKey.trim()
            ? data.pageKey.trim()
            : null
        if (!nextPageKey) break
        if (seenPageKeys.has(nextPageKey)) {
            partial = true
            failureCode = 'ALCHEMY_PORTFOLIO_PAGE_KEY_REPEATED'
            break
        }
        seenPageKeys.add(nextPageKey)
        pageKey = nextPageKey
        if (pageCount >= config.maxPages) {
            partial = true
            failureCode = 'ALCHEMY_PORTFOLIO_MAX_PAGES_REACHED'
            break
        }
    } while (pageKey)

    return {
        batchIndex,
        chainIds,
        networks: networkBatch,
        tokens: [...tokens.values()],
        pageCount,
        partial,
        failureCode,
        skippedRecordCount,
    }
}

async function boundedAllSettled<T, R>(
    values: readonly T[],
    concurrency: number,
    operation: (value: T, index: number) => Promise<R>,
) {
    const results = new Array<PromiseSettledResult<R>>(values.length)
    let cursor = 0
    const workers = Array.from(
        { length: Math.min(concurrency, values.length) },
        async () => {
            while (cursor < values.length) {
                const index = cursor
                cursor += 1
                try {
                    results[index] = {
                        status: 'fulfilled',
                        value: await operation(values[index], index),
                    }
                } catch (reason) {
                    results[index] = { status: 'rejected', reason }
                }
            }
        },
    )
    await Promise.all(workers)
    return results
}

function providerError(value: unknown) {
    return value instanceof ProviderError
        ? value
        : new ProviderError({
              code: 'ALCHEMY_PORTFOLIO_UNAVAILABLE',
              message: 'Wallet balances are temporarily unavailable.',
              statusCode: 503,
              retryable: true,
              outcome: 'upstream',
              cause: value,
          })
}

type IsolatedBatchResult = {
    batches: AlchemyPortfolioBatchResult[]
    errors: Array<{
        chainIds: number[]
        error: ProviderError
    }>
    providerRejectedChainIds: number[]
}

async function fetchWithRequestInvalidIsolation({
    walletAddress,
    networks,
    includeZero,
    signal,
    batchIndex,
    configurationId,
    dependencies,
}: {
    walletAddress: string
    networks: AlchemyPortfolioNetwork[]
    includeZero: boolean
    signal?: AbortSignal
    batchIndex: number
    configurationId: string
    dependencies: Dependencies
}): Promise<IsolatedBatchResult> {
    const chainIds = networks.map((network) =>
        getChainIdForAlchemyPortfolioNetwork(network)!,
    )
    try {
        const batch = await fetchAlchemyPortfolioNetworkBatch({
            walletAddress,
            networks,
            includeZero,
            signal,
            batchIndex,
        }, dependencies)
        if (networks.length === 1) {
            writeSupportCache(configurationId, networks[0], 'supported')
        }
        return { batches: [batch], errors: [], providerRejectedChainIds: [] }
    } catch (reason) {
        const error = providerError(reason)
        if (error.code !== 'ALCHEMY_PORTFOLIO_REQUEST_INVALID') {
            return {
                batches: [],
                errors: [{ chainIds, error }],
                providerRejectedChainIds: [],
            }
        }
        if (networks.length === 1) {
            writeSupportCache(configurationId, networks[0], 'provider-rejected')
            return {
                batches: [],
                errors: [],
                providerRejectedChainIds: chainIds,
            }
        }

        const midpoint = Math.ceil(networks.length / 2)
        const groups = [
            networks.slice(0, midpoint),
            networks.slice(midpoint),
        ]
        const isolated: IsolatedBatchResult = {
            batches: [],
            errors: [],
            providerRejectedChainIds: [],
        }
        for (const group of groups) {
            const result = await fetchWithRequestInvalidIsolation({
                walletAddress,
                networks: group,
                includeZero,
                signal,
                batchIndex,
                configurationId,
                dependencies,
            })
            isolated.batches.push(...result.batches)
            isolated.errors.push(...result.errors)
            isolated.providerRejectedChainIds.push(
                ...result.providerRejectedChainIds,
            )
        }
        return isolated
    }
}

export async function fetchAlchemyPortfolioTokens({
    walletAddress,
    chainIds,
    includeZero = false,
    signal,
}: {
    walletAddress: string
    chainIds: readonly number[]
    includeZero?: boolean
    signal?: AbortSignal
}, dependencies: Dependencies): Promise<AlchemyPortfolioTokensResult> {
    const wallet = normalizeAddress(walletAddress)
    if (!wallet) {
        throw new ProviderError({
            code: 'INVALID_WALLET_ADDRESS',
            message: 'A valid wallet address is required.',
            statusCode: 400,
            outcome: 'validation',
        })
    }
    if (!dependencies.config.apiKey) {
        throw new ProviderError({
            code: 'ALCHEMY_PORTFOLIO_CONFIGURATION_ERROR',
            message: 'The wallet portfolio provider is not configured correctly.',
            statusCode: 503,
            outcome: 'configuration',
        })
    }

    const requestedChainIds = [...new Set(chainIds.map(Number))]
        .filter(Number.isSafeInteger)
        .sort((left, right) => left - right)
    const unsupportedChainIds = getUnsupportedPortfolioChainIds(requestedChainIds)
    const supportedChainIds = requestedChainIds.filter(
        (chainId) => getAlchemyPortfolioNetwork(chainId) !== null,
    )
    if (supportedChainIds.length === 0) {
        return {
            walletAddress: wallet,
            requestedChainIds,
            supportedChainIds,
            unsupportedChainIds,
            queriedChainIds: [],
            successfulChainIds: [],
            failedChainIds: [],
            providerRejectedChainIds: [],
            batchErrors: [],
            batches: [],
            tokens: [],
            pageCount: 0,
            partial: false,
            failureCode: null,
            skippedRecordCount: 0,
        }
    }

    const configurationId = supportCacheConfigurationId(
        dependencies.config.apiKey,
    )
    const providerRejectedChainIds: number[] = []
    const networks = supportedChainIds.map(
        (chainId) => getAlchemyPortfolioNetwork(chainId)!,
    ).filter((network) => {
        if (readSupportCache(configurationId, network) !== 'provider-rejected') {
            return true
        }
        providerRejectedChainIds.push(
            getChainIdForAlchemyPortfolioNetwork(network)!,
        )
        return false
    })
    if (networks.length === 0) {
        return {
            walletAddress: wallet,
            requestedChainIds,
            supportedChainIds,
            unsupportedChainIds,
            queriedChainIds: [],
            successfulChainIds: [],
            failedChainIds: [],
            providerRejectedChainIds: providerRejectedChainIds.sort(
                (left, right) => left - right,
            ),
            batchErrors: providerRejectedChainIds.map((chainId, batchIndex) => ({
                batchIndex,
                chainIds: [chainId],
                code: 'ALCHEMY_PORTFOLIO_REQUEST_INVALID',
            })),
            batches: [],
            tokens: [],
            pageCount: 0,
            partial: providerRejectedChainIds.length > 0,
            failureCode: providerRejectedChainIds.length > 0
                ? 'ALCHEMY_PORTFOLIO_REQUEST_INVALID'
                : null,
            skippedRecordCount: 0,
        }
    }
    const networkBatches = chunkAlchemyPortfolioNetworks(networks)
    const settled = await boundedAllSettled(
        networkBatches,
        ALCHEMY_PORTFOLIO_BATCH_CONCURRENCY,
        (batch, batchIndex) => fetchWithRequestInvalidIsolation({
            walletAddress: wallet,
            networks: batch,
            includeZero,
            signal,
            batchIndex,
            configurationId,
            dependencies,
        }),
    )

    const batches: AlchemyPortfolioBatchResult[] = []
    const batchErrors: AlchemyPortfolioBatchError[] = []
    const errors: ProviderError[] = []
    const failedChainIds: number[] = []
    const tokens = new Map<string, AlchemyPortfolioToken>()
    for (let batchIndex = 0; batchIndex < settled.length; batchIndex += 1) {
        const result = settled[batchIndex]
        if (result.status === 'rejected') {
            const error = providerError(result.reason)
            errors.push(error)
            const batchChainIds = networkBatches[batchIndex].map((network) =>
                getChainIdForAlchemyPortfolioNetwork(network)!,
            )
            failedChainIds.push(...batchChainIds)
            batchErrors.push({
                batchIndex,
                chainIds: batchChainIds,
                code: error.code,
            })
            continue
        }
        providerRejectedChainIds.push(...result.value.providerRejectedChainIds)
        for (const failure of result.value.errors) {
            errors.push(failure.error)
            failedChainIds.push(...failure.chainIds)
            batchErrors.push({
                batchIndex,
                chainIds: failure.chainIds,
                code: failure.error.code,
            })
        }
        for (const rejectedChainId of result.value.providerRejectedChainIds) {
            batchErrors.push({
                batchIndex,
                chainIds: [rejectedChainId],
                code: 'ALCHEMY_PORTFOLIO_REQUEST_INVALID',
            })
        }
        batches.push(...result.value.batches)
        for (const batch of result.value.batches) {
            for (const token of batch.tokens) {
                const key = `${token.chainId}:${token.address}`
                tokens.set(key, mergeDuplicate(tokens.get(key), token))
            }
        }
    }

    if (batches.length === 0 && providerRejectedChainIds.length === 0) {
        const aborted = errors.find((error) =>
            error.code === 'ALCHEMY_PORTFOLIO_REQUEST_ABORTED',
        )
        if (aborted) throw aborted
        const commonCode = errors[0]?.code
        const sameFailure = errors.every((error) => error.code === commonCode)
        if (sameFailure && errors[0]) throw errors[0]
        throw new ProviderError({
            code: 'ALCHEMY_PORTFOLIO_UNAVAILABLE',
            message: 'Wallet balances are temporarily unavailable.',
            statusCode: 503,
            retryable: errors.some((error) => error.retryable),
            outcome: 'upstream',
        })
    }

    const successfulChainIds = batches
        .flatMap((batch) => batch.chainIds)
        .sort((left, right) => left - right)
    const failureCodes = [
        ...batchErrors.map((error) => error.code),
        ...batches.flatMap((batch) => batch.failureCode ? [batch.failureCode] : []),
    ]
    return {
        walletAddress: wallet,
        requestedChainIds,
        supportedChainIds,
        unsupportedChainIds,
        queriedChainIds: networks.map((network) =>
            getChainIdForAlchemyPortfolioNetwork(network)!,
        ).sort((left, right) => left - right),
        successfulChainIds,
        failedChainIds: failedChainIds.sort((left, right) => left - right),
        providerRejectedChainIds: [...new Set(providerRejectedChainIds)].sort(
            (left, right) => left - right,
        ),
        batchErrors,
        batches,
        tokens: [...tokens.values()],
        pageCount: batches.reduce((total, batch) => total + batch.pageCount, 0),
        partial:
            batchErrors.length > 0 ||
            providerRejectedChainIds.length > 0 ||
            batches.some((batch) => batch.partial),
        failureCode: failureCodes[0] ?? null,
        skippedRecordCount: batches.reduce(
            (total, batch) => total + batch.skippedRecordCount,
            0,
        ),
    }
}
