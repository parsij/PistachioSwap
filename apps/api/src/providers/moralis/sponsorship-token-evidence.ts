import { getApiConfig } from '../../config.js'
import { normalizeAddress } from '../../lib/address.js'
import { setBoundedCacheEntry } from '../../lib/bounded-cache.js'
import { fetchJson, isRecord } from '../../lib/http.js'
import { requireActiveTokenDiscoveryChain } from '../../token-discovery/registry.js'

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { expiresAt: number; value: MoralisSponsorshipTokenEvidence }>()
const pending = new Map<string, Promise<MoralisSponsorshipTokenEvidence>>()

export type MoralisSponsorshipTokenEvidence = {
    available: boolean
    checkedAt: Date
    tokenAddress: string
    priceUsd: string | null
    liquidityUsd: string | null
    securityScore: number | null
    possibleSpam: boolean | null
    verifiedContract: boolean | null
    pairAddress: string | null
    exchangeAddress: string | null
    exchangeName: string | null
}

function nullableBoolean(value: unknown) {
    if (value === true || value === 'true') return true
    if (value === false || value === 'false') return false
    return null
}

function nullableAddress(value: unknown) {
    return normalizeAddress(value)
}

function nullableText(value: unknown, maximum = 120) {
    if (typeof value !== 'string') return null
    const normalized = value.replace(/\s+/g, ' ').trim()
    return normalized && normalized.length <= maximum ? normalized : null
}

function normalizedDecimal(value: unknown, scale = 6) {
    if (typeof value !== 'string' && typeof value !== 'number') return null
    const text = String(value).trim()
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return null

    const [whole, fraction = ''] = text.split('.')
    const base = 10n ** BigInt(scale)
    const retained = fraction.slice(0, scale).padEnd(scale, '0')
    let scaled = BigInt(whole) * base + BigInt(retained || '0')

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

function nullableScore(value: unknown) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
        ? Math.round(parsed)
        : null
}

function unavailableEvidence(address: string, checkedAt = new Date()): MoralisSponsorshipTokenEvidence {
    return {
        available: false,
        checkedAt,
        tokenAddress: address,
        priceUsd: null,
        liquidityUsd: null,
        securityScore: null,
        possibleSpam: null,
        verifiedContract: null,
        pairAddress: null,
        exchangeAddress: null,
        exchangeName: null,
    }
}

export function normalizeMoralisSponsorshipTokenEvidence(
    value: unknown,
    expectedAddress: string,
    checkedAt = new Date(),
): MoralisSponsorshipTokenEvidence {
    const expected = normalizeAddress(expectedAddress)
    if (!expected || !isRecord(value)) return unavailableEvidence(expectedAddress, checkedAt)

    const returnedAddress = normalizeAddress(value.tokenAddress)
    if (returnedAddress && returnedAddress !== expected) {
        return unavailableEvidence(expected, checkedAt)
    }

    return {
        available: true,
        checkedAt,
        tokenAddress: expected,
        priceUsd: normalizedDecimal(value.usdPriceFormatted ?? value.usdPrice),
        liquidityUsd: normalizedDecimal(value.pairTotalLiquidityUsd),
        securityScore: nullableScore(value.securityScore),
        possibleSpam: nullableBoolean(value.possibleSpam),
        verifiedContract: nullableBoolean(value.verifiedContract),
        pairAddress: nullableAddress(value.pairAddress),
        exchangeAddress: nullableAddress(value.exchangeAddress),
        exchangeName: nullableText(value.exchangeName),
    }
}

export async function getMoralisSponsorshipTokenEvidence(
    address: string,
    signal?: AbortSignal,
    chainId = 56,
): Promise<MoralisSponsorshipTokenEvidence> {
    const normalized = normalizeAddress(address)
    if (!normalized) return unavailableEvidence(address)

    const config = getApiConfig().moralis
    const chain = requireActiveTokenDiscoveryChain(chainId)
    if (!chain.capabilities.moralis || !chain.providers.moralisChain || !config.enabled || !config.apiKey) {
        return unavailableEvidence(normalized)
    }

    const key = `${chainId}:${normalized}`
    const cached = cache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    const inFlight = pending.get(key)
    if (inFlight) return inFlight

    const request = (async () => {
        const checkedAt = new Date()
        try {
            const url = new URL(`${config.baseUrl}/erc20/${encodeURIComponent(normalized)}/price`)
            url.searchParams.set('chain', chain.providers.moralisChain!)

            const payload = await fetchJson(url, {
                headers: { 'X-API-Key': config.apiKey! },
                signal,
                timeoutMs: config.requestTimeoutMs,
                retries: 1,
                notFoundAsNull: true,
                dedupeKey: `moralis:sponsorship-token-evidence:${key}`,
            })

            const value = normalizeMoralisSponsorshipTokenEvidence(payload, normalized, checkedAt)
            setBoundedCacheEntry(cache, key, {
                expiresAt: Date.now() + CACHE_TTL_MS,
                value,
            }, 1_000)
            return value
        } catch {
            const value = unavailableEvidence(normalized, checkedAt)
            if (!signal?.aborted) {
                setBoundedCacheEntry(cache, key, {
                    expiresAt: Date.now() + CACHE_TTL_MS,
                    value,
                }, 1_000)
            }
            return value
        }
    })().finally(() => pending.delete(key))

    pending.set(key, request)
    return request
}

export const moralisSponsorshipEvidenceInternals = {
    normalizedDecimal,
    normalizeMoralisSponsorshipTokenEvidence,
}
