import { getApiConfig } from '../../config.js'
import { normalizeAddress } from '../../lib/address.js'
import { setBoundedCacheEntry } from '../../lib/bounded-cache.js'
import { fetchJson, isRecord } from '../../lib/http.js'
import { logProviderResponse } from '../../lib/provider-response-debug.js'
import { requireActiveTokenDiscoveryChain } from '../../token-discovery/registry.js'
import { coinGeckoRequest } from '../coingecko/coingecko-client.js'
import { getMoralisSponsorshipTokenEvidence } from '../moralis/sponsorship-token-evidence.js'

const PRICE_TTL_MS = 45_000
const USD_PRICE_SCALE = 6
const priceCache = new Map<string, { expiresAt: number; observedAt: number; value: string | null }>()
const pendingPrices = new Map<string, Promise<Map<string, string>>>()
const nativePriceCache = new Map<number, { expiresAt: number; value: string | null }>()
const pendingNativePrices = new Map<number, Promise<string | null>>()

type NativePriceProvider = 'alchemy' | 'moralis' | 'coingecko'
type NativePriceSource = {
    provider: NativePriceProvider
    load: () => Promise<string | null>
}

function normalizeUsdPrice(value: string, scale = USD_PRICE_SCALE) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || !Number.isInteger(scale) || scale < 0) {
        return null
    }

    const [whole, fraction = ''] = value.split('.')
    const base = 10n ** BigInt(scale)
    const retainedFraction = fraction.slice(0, scale).padEnd(scale, '0')
    let scaled = BigInt(whole) * base + BigInt(retainedFraction || '0')

    if (fraction.length > scale && fraction[scale]! >= '5') {
        scaled += 1n
    }

    if (scale === 0) return scaled.toString()

    const normalizedWhole = scaled / base
    const normalizedFraction = (scaled % base)
        .toString()
        .padStart(scale, '0')
        .replace(/0+$/, '')

    return normalizedFraction
        ? `${normalizedWhole}.${normalizedFraction}`
        : normalizedWhole.toString()
}

async function resolveNativePriceSources(
    chainId: number,
    sources: NativePriceSource[],
): Promise<{ value: string; provider: NativePriceProvider } | null> {
    for (const source of sources) {
        try {
            const value = await source.load()
            if (value) {
                if (process.env.DEBUG_SPONSORSHIP_PROVIDER_RESPONSES === 'true') {
                    console.log('[sponsorship-native-price-selected]', {
                        chainId,
                        provider: source.provider,
                        value,
                    })
                }
                return { value, provider: source.provider }
            }

            logProviderResponse(source.provider, `native-price-unusable:${chainId}`, {
                reason: 'Provider returned no usable USD price.',
            })
        } catch (error) {
            logProviderResponse(source.provider, `native-price-error:${chainId}`, error)
        }
    }

    if (process.env.DEBUG_SPONSORSHIP_PROVIDER_RESPONSES === 'true') {
        console.warn('[sponsorship-native-price-unavailable]', {
            chainId,
            providersTried: sources.map((source) => source.provider),
        })
    }
    return null
}

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
            logProviderResponse('alchemy', `token-prices:${chainId}`, payload)

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
                const value = isRecord(usd) && typeof usd.value === 'string'
                    ? normalizeUsdPrice(usd.value)
                    : null

                if (address && value !== null) {
                    fetched.set(address, value)
                }
            }
        } catch (error) {
            logProviderResponse('alchemy', `token-prices-error:${chainId}`, error)
        }

        for (const address of missing) {
            setBoundedCacheEntry(priceCache, `${chainId}:${address}`, {
                expiresAt: Date.now() + PRICE_TTL_MS,
                observedAt: Date.now(),
                value: fetched.get(address) ?? null,
            })
        }
        return fetched
    })().finally(() => pendingPrices.delete(requestKey))

    pendingPrices.set(requestKey, request)
    for (const [address, value] of await request) prices.set(address, value)

    return prices
}

export async function getAuthoritativeTokenUsdPrice({
    chainId,
    address,
    signal,
}: {
    chainId: number
    address: string
    signal?: AbortSignal
}): Promise<{ priceUsd: string; observedAt: number; source: 'alchemy' } | null> {
    const normalized = normalizeAddress(address)
    if (!normalized) return null

    await getTokenPrices({ chainId, addresses: [normalized], signal })
    const cached = priceCache.get(`${chainId}:${normalized}`)
    if (!cached || cached.expiresAt <= Date.now() || !cached.value) return null

    return { priceUsd: cached.value, observedAt: cached.observedAt, source: 'alchemy' }
}

export async function getNativeTokenPrice(chainId = 56, signal?: AbortSignal) {
    const chain = requireActiveTokenDiscoveryChain(chainId)
    const cached = nativePriceCache.get(chainId)
    if (cached && cached.expiresAt > Date.now()) {
        if (process.env.DEBUG_SPONSORSHIP_PROVIDER_RESPONSES === 'true') {
            console.log('[sponsorship-native-price-cache-hit]', {
                chainId,
                value: cached.value,
                expiresAt: new Date(cached.expiresAt).toISOString(),
            })
        }
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
        logProviderResponse('alchemy', `native-price:${chainId}:${chain.native.symbol}`, payload)

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
        return isRecord(usd) && typeof usd.value === 'string'
            ? normalizeUsdPrice(usd.value)
            : null
    }

    const moralisPrice = async () => {
        const evidence = await getMoralisSponsorshipTokenEvidence(
            chain.wrappedNative.address,
            signal,
            chainId,
        )
        return evidence.available && evidence.priceUsd
            ? normalizeUsdPrice(evidence.priceUsd)
            : null
    }

    const coinGeckoPrice = async () => {
        const payload = await coinGeckoRequest(
            `/simple/price?ids=${encodeURIComponent(chain.native.coinGeckoId)}&vs_currencies=usd`,
            { signal },
        )
        logProviderResponse('coingecko', `native-price:${chainId}:${chain.native.coinGeckoId}`, payload)

        const native = isRecord(payload) && isRecord(payload[chain.native.coinGeckoId])
            ? payload[chain.native.coinGeckoId]
            : null
        const value = isRecord(native) ? native.usd : null
        const normalized = typeof value === 'string' || typeof value === 'number'
            ? String(value)
            : null
        return normalized ? normalizeUsdPrice(normalized) : null
    }

    const request = resolveNativePriceSources(chainId, [
        { provider: 'alchemy', load: alchemyPrice },
        { provider: 'moralis', load: moralisPrice },
        { provider: 'coingecko', load: coinGeckoPrice },
    ])
        .then((result) => {
            const value = result?.value ?? null
            setBoundedCacheEntry(nativePriceCache, chainId, {
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

export const tokenPriceInternals = {
    normalizeUsdPrice,
    resolveNativePriceSources,
}
