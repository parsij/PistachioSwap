import { getApiConfig } from '../../config.js'
import { normalizeAddress } from '../../lib/address.js'
import { fetchJson, isRecord } from '../../lib/http.js'
import { coinGeckoRequest } from '../coingecko/coingecko-client.js'
import { requireActiveTokenDiscoveryChain } from '../../token-discovery/registry.js'

const PRICE_TTL_MS = 45_000
const priceCache = new Map<string, { expiresAt: number; value: string | null }>()
const pendingPrices = new Map<string, Promise<Map<string, string>>>()
const nativePriceCache = new Map<number, { expiresAt: number; value: string | null }>()
const pendingNativePrices = new Map<number, Promise<string | null>>()

function readPrice(key: string) {
    const cached = priceCache.get(key)
    if (!cached || cached.expiresAt <= Date.now()) {
        priceCache.delete(key)
        return undefined
    }
    return cached.value
}

export async function getTokenPrices({
    chainId = 56,
    addresses,
    signal,
}: {
    chainId?: number
    addresses: string[]
    signal?: AbortSignal
}): Promise<Map<string, string>> {
    const config = getApiConfig().alchemy
    const chain = requireActiveTokenDiscoveryChain(chainId)
    const prices = new Map<string, string>()
    const normalized = [
        ...new Set(
            addresses
                .map(normalizeAddress)
                .filter((address): address is string => address !== null),
        ),
    ]
    const missing: string[] = []

    for (const address of normalized) {
        const cached = readPrice(`${chainId}:${address}`)
        if (cached === undefined) missing.push(address)
        else if (cached !== null) prices.set(address, cached)
    }

    if (!chain.capabilities.alchemy || !chain.providers.alchemyNetwork ||
        !config.apiKey || missing.length === 0) return prices

    const requestKey = `${chainId}:${missing.sort().join(',')}`
    const pending = pendingPrices.get(requestKey)
    if (pending) {
        const values = await pending
        for (const [address, value] of values) prices.set(address, value)
        return prices
    }

    const url = new URL(
        `https://api.g.alchemy.com/prices/v1/${encodeURIComponent(config.apiKey)}/tokens/by-address`,
    )

    const request = (async () => {
        const fetched = new Map<string, string>()
        try {
        const payload = await fetchJson(url, {
            method: 'POST',
            body: {
                addresses: missing.map((address) => ({
                    network: chain.providers.alchemyNetwork,
                    address,
                })),
            },
            signal,
            timeoutMs: getApiConfig().requestTimeoutMs,
            dedupeKey: `alchemy:prices:${requestKey}`,
        })

        if (!isRecord(payload) || !Array.isArray(payload.data)) {
            return fetched
        }

        for (const item of payload.data) {
            if (!isRecord(item) || !Array.isArray(item.prices)) continue
            const address = normalizeAddress(item.address)
            const usd = item.prices.find(
                (price) =>
                    isRecord(price) &&
                    String(price.currency).toLowerCase() === 'usd',
            )
            const value = isRecord(usd) ? usd.value : null

            if (
                address &&
                typeof value === 'string' &&
                /^\d+(?:\.\d+)?$/.test(value)
            ) {
                fetched.set(address, value)
            }
        }
        } catch {
        // Prices are optional; metadata and balances remain usable.
        }

        for (const address of missing) {
            priceCache.set(`${chainId}:${address}`, {
                expiresAt: Date.now() + PRICE_TTL_MS,
                value: fetched.get(address) ?? null,
            })
        }
        return fetched
    })().finally(() => pendingPrices.delete(requestKey))

    pendingPrices.set(requestKey, request)
    for (const [address, value] of await request) prices.set(address, value)

    return prices
}

export async function getNativeTokenPrice(chainId = 56, signal?: AbortSignal) {
    const chain = requireActiveTokenDiscoveryChain(chainId)
    const cached = nativePriceCache.get(chainId)
    if (cached && cached.expiresAt > Date.now()) {
        return cached.value
    }
    const pending = pendingNativePrices.get(chainId)
    if (pending) return pending

    const config = getApiConfig().alchemy
    const alchemyPrice = async () => {
        if (!chain.capabilities.alchemy || !config.apiKey) return null
        const url = new URL(
            `https://api.g.alchemy.com/prices/v1/${encodeURIComponent(config.apiKey)}/tokens/by-symbol`,
        )
        url.searchParams.set('symbols', chain.native.symbol)
        const payload = await fetchJson(url, {
            signal,
            timeoutMs: getApiConfig().requestTimeoutMs,
            dedupeKey: `alchemy:prices:native:${chainId}`,
        })
            const data = isRecord(payload) && Array.isArray(payload.data)
                ? payload.data
                : []
            const native = data.find(
                (item) => isRecord(item) && String(item.symbol).toUpperCase() === chain.native.symbol.toUpperCase(),
            )
            const usd = isRecord(native) && Array.isArray(native.prices)
                ? native.prices.find(
                      (price) =>
                          isRecord(price) &&
                          String(price.currency).toLowerCase() === 'usd',
                  )
                : null
            return isRecord(usd) &&
                typeof usd.value === 'string' &&
                /^\d+(?:\.\d+)?$/.test(usd.value)
                ? usd.value
                : null
    }
    const coinGeckoPrice = async () => {
        const payload = await coinGeckoRequest(
            `/simple/price?ids=${encodeURIComponent(chain.native.coinGeckoId)}&vs_currencies=usd`,
            { signal },
        )
        const native = isRecord(payload) && isRecord(payload[chain.native.coinGeckoId])
            ? payload[chain.native.coinGeckoId]
            : null
        const value = isRecord(native) ? native.usd : null
        const normalized = typeof value === 'string' || typeof value === 'number'
            ? String(value)
            : null
        return normalized && /^\d+(?:\.\d+)?$/.test(normalized)
            ? normalized
            : null
    }

    const request = alchemyPrice()
        .catch(() => null)
        .then((value) => value ?? coinGeckoPrice().catch(() => null))
        .then((value) => {
            nativePriceCache.set(chainId, {
                value,
                expiresAt: Date.now() + PRICE_TTL_MS,
            })
            return value
        })
        .finally(() => {
            pendingNativePrices.delete(chainId)
        })

    pendingNativePrices.set(chainId, request)
    return request
}

export function getNativeBnbPrice(signal?: AbortSignal, chainId = 56) {
    return getNativeTokenPrice(chainId, signal)
}
