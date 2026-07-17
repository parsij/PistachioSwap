import { getApiConfig } from '../../config.js'
import { normalizeAddress } from '../../lib/address.js'
import {
    isRecord,
    validateRemoteImageUrl,
} from '../../lib/http.js'
import { coinGeckoRequest } from './coingecko-client.js'
import { tokenDiscoveryContext } from '../../token-discovery/context.js'

export type CoinGeckoToken = {
    address: string
    name: string | null
    symbol: string | null
    decimals: number | null
    imageUrl: string | null
    coinGeckoId: string | null
    priceUSD: string | null
    imageSource: 'coingecko'
}

type TokenCacheEntry = {
    expiresAt: number
    token: CoinGeckoToken | null
}

export type CoinGeckoTokenBatchResult = {
    tokens: Map<string, CoinGeckoToken>
    partial: boolean
    successfulBatches: number
    failedBatches: number
}

const tokenCache = new Map<string, TokenCacheEntry>()

function normalizedText(value: unknown, maximum: number) {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized && normalized.length <= maximum
        ? normalized
        : null
}

function normalizedDecimals(value: unknown) {
    if (typeof value !== 'number' && typeof value !== 'string') return null
    const decimals = Number(value)
    return Number.isInteger(decimals) && decimals >= 0 && decimals <= 255
        ? decimals
        : null
}

function normalizedPrice(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) return null
    const price = Number(value)
    return Number.isFinite(price) && price >= 0 ? value.trim() : null
}

export function normalizeCoinGeckoToken(
    value: unknown,
    expectedNetwork: string,
): CoinGeckoToken | null {
    if (!isRecord(value) || value.type !== 'token') return null
    if (
        typeof value.id !== 'string' ||
        !value.id.toLowerCase().startsWith(`${expectedNetwork.toLowerCase()}_`)
    ) {
        return null
    }
    if (!isRecord(value.attributes)) return null
    if (
        value.attributes.is_inactive === true ||
        value.attributes.active === false
    ) {
        return null
    }

    const address = normalizeAddress(value.attributes.address)
    const idAddress = normalizeAddress(
        value.id.slice(value.id.lastIndexOf('_') + 1),
    )
    if (!address || idAddress !== address) return null

    return {
        address,
        name: normalizedText(value.attributes.name, 120),
        symbol: normalizedText(value.attributes.symbol, 32),
        decimals: normalizedDecimals(value.attributes.decimals),
        imageUrl: validateRemoteImageUrl(value.attributes.image_url),
        coinGeckoId: normalizedText(
            value.attributes.coingecko_coin_id,
            160,
        ),
        priceUSD: normalizedPrice(value.attributes.price_usd),
        imageSource: 'coingecko',
    }
}

function readTokenCache(key: string) {
    const cached = tokenCache.get(key)
    if (!cached || cached.expiresAt <= Date.now()) {
        tokenCache.delete(key)
        return undefined
    }
    return cached.token
}

export async function getCoinGeckoToken(
    address: string,
    signal?: AbortSignal,
    chainId = 56,
) {
    const normalized = normalizeAddress(address)
    if (!normalized) return null

    const config = getApiConfig().coinGecko
    const context = tokenDiscoveryContext(chainId)
    if (!context.chain.capabilities.coinGeckoOnchain) return null
    const network = context.chain.providers.coinGeckoNetwork
    const cacheKey = `${chainId}:${network}:${normalized}`
    const cached = readTokenCache(cacheKey)
    if (cached !== undefined) return cached

    const payload = await coinGeckoRequest(
        `/onchain/networks/${encodeURIComponent(network)}` +
            `/tokens/${encodeURIComponent(normalized)}/info`,
        { signal, notFoundAsNull: true },
    )
    const parsedToken =
        payload === null || !isRecord(payload)
            ? null
            : normalizeCoinGeckoToken(payload.data, network)
    const token =
        parsedToken?.address === normalized ? parsedToken : null

    tokenCache.set(cacheKey, {
        token,
        expiresAt:
            Date.now() +
            (token ? config.tokenTtlMs : config.negativeTokenTtlMs),
    })

    return token
}

function chunks<T>(values: T[], size: number) {
    const result: T[][] = []
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size))
    }
    return result
}

export async function getCoinGeckoTokensBatch(
    addresses: string[],
    signal?: AbortSignal,
    chainId = 56,
): Promise<CoinGeckoTokenBatchResult> {
    const config = getApiConfig().coinGecko
    const context = tokenDiscoveryContext(chainId)
    if (!context.chain.capabilities.coinGeckoOnchain) {
        return { tokens: new Map(), partial: true, successfulBatches: 0, failedBatches: 0 }
    }
    const network = context.chain.providers.coinGeckoNetwork
    const unique = [
        ...new Set(
            addresses
                .map(normalizeAddress)
                .filter((value): value is string => value !== null),
        ),
    ]
    const tokens = new Map<string, CoinGeckoToken>()
    const missing: string[] = []

    for (const address of unique) {
        const cached = readTokenCache(`${chainId}:${network}:${address}`)
        if (cached === undefined) {
            missing.push(address)
        } else if (cached) {
            tokens.set(address, cached)
        }
    }

    let successfulBatches = 0
    let failedBatches = 0
    let lastError: unknown

    for (const batch of chunks(missing, 30)) {
        try {
            const payload = await coinGeckoRequest(
                `/onchain/networks/${encodeURIComponent(network)}` +
                    `/tokens/multi/${batch.map(encodeURIComponent).join(',')}`,
                { signal },
            )
            const values =
                isRecord(payload) && Array.isArray(payload.data)
                    ? payload.data
                    : []
            const returned = new Map<string, CoinGeckoToken>()

            for (const value of values) {
                const token = normalizeCoinGeckoToken(value, network)
                if (!token || !batch.includes(token.address)) continue
                returned.set(token.address, token)
                tokens.set(token.address, token)
            }

            for (const address of batch) {
                const token = returned.get(address) ?? null
                tokenCache.set(`${chainId}:${network}:${address}`, {
                    token,
                    expiresAt:
                        Date.now() +
                        (token
                            ? config.tokenTtlMs
                            : config.negativeTokenTtlMs),
                })
            }
            successfulBatches += 1
        } catch (error) {
            lastError = error
            failedBatches += 1
        }
    }

    if (
        missing.length > 0 &&
        successfulBatches === 0 &&
        tokens.size === 0 &&
        lastError
    ) {
        throw lastError
    }

    return {
        tokens,
        partial: failedBatches > 0,
        successfulBatches,
        failedBatches,
    }
}
