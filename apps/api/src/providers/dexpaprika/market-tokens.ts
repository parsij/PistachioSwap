import { normalizeAddress } from '../../lib/address.js'
import { isRecord } from '../../lib/http.js'
import { dexPaprikaRequest } from './client.js'
import { getDexPaprikaNetworkId } from './networks.js'
import type { DexPaprikaMarketToken, DexPaprikaMarketTokenResult } from './types.js'

function text(value: unknown, maximum: number) {
    if (typeof value !== 'string') return null
    const result = value.trim()
    return result && result.length <= maximum ? result : null
}

function finite(value: unknown, { required = false, integer = false } = {}) {
    if (value === null || value === undefined) return required ? null : null
    if (typeof value !== 'number' && typeof value !== 'string') return null
    const result = Number(value)
    if (!Number.isFinite(result) || result < 0 || (integer && !Number.isInteger(result))) return null
    return result
}

function date(value: unknown) {
    const candidate = text(value, 64)
    return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null
}

export function parseDexPaprikaToken(value: unknown, chainId: number, networkId: string): DexPaprikaMarketToken | null {
    if (!isRecord(value) || value.chain !== networkId) return null
    const address = normalizeAddress(value.address)
    const name = text(value.name, 120)
    const symbol = text(value.symbol, 32)
    const decimals = finite(value.decimals, { required: true, integer: true })
    const volume24hUsd = finite(value.volume_usd_24h, { required: true })
    const liquidityUsd = finite(value.liquidity_usd, { required: true })
    const transactions24h = finite(value.txns_24h, { required: true, integer: true })
    if (!address || !name || !symbol || decimals === null || decimals > 255 ||
        volume24hUsd === null || liquidityUsd === null || transactions24h === null) return null
    const price = finite(value.price_usd)
    const priceUSD = price === null ? null : String(price)
    return {
        provider: 'dexpaprika', chainId, address, name, symbol, decimals,
        priceUSD, marketPriceUSD: priceUSD,
        priceChange24hPercent: finite(value.price_change_percentage_24h),
        volume24hUsd, volume7dUsd: finite(value.volume_usd_7d),
        volume30dUsd: finite(value.volume_usd_30d), liquidityUsd,
        fdvUsd: finite(value.fdv_usd), transactions24h,
        poolsCount: finite(value.pools, { integer: true }), createdAt: date(value.created_at),
        hasProviderImage: value.has_image === true,
        recognitionStatus: 'unverified', verifiedContract: false,
        possibleSpam: null, securityStatus: 'unknown', visibility: 'unverified',
        logoURI: null, logoCandidates: [],
    }
}

export async function fetchDexPaprikaMarketTokens({
    chainId, limit = 100, liquidityMinimumUsd, transactionMinimum24h, signal,
}: {
    chainId: number
    limit?: number
    liquidityMinimumUsd: number
    transactionMinimum24h: number
    signal?: AbortSignal
}): Promise<DexPaprikaMarketTokenResult> {
    const networkId = getDexPaprikaNetworkId(chainId)
    if (!networkId) throw new Error('DexPaprika does not support this configured chain.')
    const requestedLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
    const params = new URLSearchParams({
        limit: String(requestedLimit), order_by: 'volume_usd_24h', sort: 'desc',
        liquidity_usd_min: String(liquidityMinimumUsd),
        txns_24h_min: String(transactionMinimum24h), detailed: 'true',
    })
    const payload = await dexPaprikaRequest(
        `networks/${encodeURIComponent(networkId)}/tokens/search`, params, signal,
    )
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
        throw new Error('DexPaprika returned an invalid token-search response.')
    }
    const tokens = payload.results.flatMap((item) => {
        const token = parseDexPaprikaToken(item, chainId, networkId)
        return token ? [token] : []
    })
    return {
        tokens, networkId, malformedCount: payload.results.length - tokens.length,
        partial: payload.has_next_page === true || tokens.length !== payload.results.length,
        hasNextPage: payload.has_next_page === true,
    }
}
