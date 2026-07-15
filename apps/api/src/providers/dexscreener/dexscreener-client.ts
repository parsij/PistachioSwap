import { getApiConfig } from '../../config.js'
import { normalizeAddress } from '../../lib/address.js'
import { fetchJson, isRecord } from '../../lib/http.js'

export type DexToken = {
    address: string
    name: string
    symbol: string
}

export type DexPair = {
    chainId: string
    dexId: string
    pairAddress: string
    url: string | null
    baseToken: DexToken
    quoteToken: DexToken
    priceUsd: string | null
    volume24hUsd: number
    liquidityUsd: number
    pairCreatedAt: number | null
}

function normalizeDexToken(value: unknown): DexToken | null {
    if (!isRecord(value)) return null
    const address = String(value.address ?? '').trim().toLowerCase()
    const name = String(value.name ?? '').trim()
    const symbol = String(value.symbol ?? '').trim()

    if (!address || !name || !symbol) return null
    return { address, name, symbol }
}

export function normalizeDexPair(value: unknown): DexPair | null {
    if (!isRecord(value)) return null
    const baseToken = normalizeDexToken(value.baseToken)
    const quoteToken = normalizeDexToken(value.quoteToken)

    const pairAddress = normalizeAddress(value.pairAddress)
    if (!baseToken || !quoteToken || !pairAddress) return null

    const volume = isRecord(value.volume)
        ? Number(value.volume.h24)
        : 0
    const liquidity = isRecord(value.liquidity)
        ? Number(value.liquidity.usd)
        : 0
    return {
        chainId: String(value.chainId ?? '').toLowerCase(),
        dexId: String(value.dexId ?? 'unknown').toLowerCase(),
        pairAddress,
        url:
            typeof value.url === 'string' && value.url.startsWith('https://')
                ? value.url
                : null,
        baseToken,
        quoteToken,
        priceUsd:
            typeof value.priceUsd === 'string' &&
            /^\d+(?:\.\d+)?$/.test(value.priceUsd)
                ? value.priceUsd
                : null,
        volume24hUsd:
            Number.isFinite(volume) && volume >= 0 ? volume : 0,
        liquidityUsd:
            Number.isFinite(liquidity) && liquidity >= 0
                ? liquidity
                : 0,
        pairCreatedAt:
            Number.isFinite(Number(value.pairCreatedAt)) &&
            Number(value.pairCreatedAt) > 0
                ? Number(value.pairCreatedAt)
                : null,
    }
}

function normalizePairs(payload: unknown): DexPair[] {
    const values = Array.isArray(payload)
        ? payload
        : isRecord(payload) && Array.isArray(payload.pairs)
          ? payload.pairs
          : []

    return values
        .map(normalizeDexPair)
        .filter((pair): pair is DexPair => pair !== null)
}

export async function dexScreenerRequest(
    path: string,
    signal?: AbortSignal,
) {
    const config = getApiConfig()
    const url = new URL(`${config.dexScreener.baseUrl}${path}`)
    const payload = await fetchJson(url, {
        signal,
        timeoutMs: config.requestTimeoutMs,
        dedupeKey: `dexscreener:${url.toString()}`,
    })
    return normalizePairs(payload)
}
