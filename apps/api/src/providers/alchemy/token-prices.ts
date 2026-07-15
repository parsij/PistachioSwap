import { getApiConfig } from '../../config.js'
import { normalizeAddress } from '../../lib/address.js'
import { fetchJson, isRecord } from '../../lib/http.js'
import { coinGeckoRequest } from '../coingecko/coingecko-client.js'

const PRICE_TTL_MS = 45_000
const priceCache = new Map<string, { expiresAt: number; value: string | null }>()
const pendingPrices = new Map<string, Promise<Map<string, string>>>()
let nativePriceCache: { expiresAt: number; value: string | null } | null = null
let pendingNativePrice: Promise<string | null> | null = null

function readPrice(address: string) {
    const cached = priceCache.get(address)
    if (!cached || cached.expiresAt <= Date.now()) {
        priceCache.delete(address)
        return undefined
    }
    return cached.value
}

export async function getTokenPrices({
    addresses,
    signal,
}: {
    addresses: string[]
    signal?: AbortSignal
}): Promise<Map<string, string>> {
    const config = getApiConfig().alchemy
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
        const cached = readPrice(address)
        if (cached === undefined) missing.push(address)
        else if (cached !== null) prices.set(address, cached)
    }

    if (!config.apiKey || missing.length === 0) return prices

    const requestKey = missing.sort().join(',')
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
                    network: config.network,
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
            priceCache.set(address, {
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

export async function getNativeBnbPrice(signal?: AbortSignal) {
    if (nativePriceCache && nativePriceCache.expiresAt > Date.now()) {
        return nativePriceCache.value
    }
    if (pendingNativePrice) return pendingNativePrice

    const config = getApiConfig().alchemy
    const alchemyPrice = async () => {
        if (!config.apiKey) return null
        const url = new URL(
            `https://api.g.alchemy.com/prices/v1/${encodeURIComponent(config.apiKey)}/tokens/by-symbol`,
        )
        url.searchParams.set('symbols', 'BNB')
        const payload = await fetchJson(url, {
            signal,
            timeoutMs: getApiConfig().requestTimeoutMs,
            dedupeKey: 'alchemy:prices:native-bnb',
        })
            const data = isRecord(payload) && Array.isArray(payload.data)
                ? payload.data
                : []
            const bnb = data.find(
                (item) => isRecord(item) && String(item.symbol).toUpperCase() === 'BNB',
            )
            const usd = isRecord(bnb) && Array.isArray(bnb.prices)
                ? bnb.prices.find(
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
            '/simple/price?ids=binancecoin&vs_currencies=usd',
            { signal },
        )
        const binancecoin = isRecord(payload) && isRecord(payload.binancecoin)
            ? payload.binancecoin
            : null
        const value = binancecoin?.usd
        const normalized = typeof value === 'string' || typeof value === 'number'
            ? String(value)
            : null
        return normalized && /^\d+(?:\.\d+)?$/.test(normalized)
            ? normalized
            : null
    }

    pendingNativePrice = alchemyPrice()
        .catch(() => null)
        .then((value) => value ?? coinGeckoPrice().catch(() => null))
        .then((value) => {
            nativePriceCache = {
                value,
                expiresAt: Date.now() + PRICE_TTL_MS,
            }
            return value
        })
        .finally(() => {
            pendingNativePrice = null
        })

    return pendingNativePrice
}
