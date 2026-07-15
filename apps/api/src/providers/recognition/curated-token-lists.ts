import { normalizeAddress } from '../../lib/address.js'
import { fetchJson, isRecord } from '../../lib/http.js'

export type CuratedRecognition = {
    pancakeSwap: boolean
    trustWallet: boolean
}

type CacheEntry = {
    expiresAt: number
    values: Map<string, CuratedRecognition>
}

const LIST_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const LIST_URLS = [
    {
        source: 'pancakeSwap' as const,
        url: 'https://tokens.pancakeswap.finance/pancakeswap-default.json',
    },
    {
        source: 'pancakeSwap' as const,
        url: 'https://tokens.pancakeswap.finance/pancakeswap-extended.json',
    },
    {
        source: 'trustWallet' as const,
        url: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/tokenlist.json',
    },
    {
        source: 'trustWallet' as const,
        url: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/tokenlist-extended.json',
    },
]

let cache: CacheEntry | null = null
let pending: Promise<Map<string, CuratedRecognition>> | null = null

export function mergeCuratedTokenList(
    target: Map<string, CuratedRecognition>,
    payload: unknown,
    source: keyof CuratedRecognition,
) {
    const values = Array.isArray(payload)
        ? payload
        : isRecord(payload) && Array.isArray(payload.tokens)
          ? payload.tokens
          : []
    for (const value of values) {
        if (!isRecord(value)) continue
        if (value.chainId !== undefined && Number(value.chainId) !== 56) continue
        const address = normalizeAddress(value.address)
        if (!address) continue
        const current = target.get(address) ?? {
            pancakeSwap: false,
            trustWallet: false,
        }
        target.set(address, { ...current, [source]: true })
    }
}

async function refresh(signal?: AbortSignal) {
    const values = new Map<string, CuratedRecognition>()
    const results = await Promise.allSettled(LIST_URLS.map(async (entry) => {
        const payload = await fetchJson(new URL(entry.url), {
            signal,
            timeoutMs: 10_000,
            retries: 1,
            dedupeKey: `curated-token-list:${entry.url}`,
        })
        mergeCuratedTokenList(values, payload, entry.source)
    }))
    if (results.every((result) => result.status === 'rejected')) {
        return cache?.values ?? values
    }
    cache = { values, expiresAt: Date.now() + LIST_CACHE_TTL_MS }
    return values
}

export async function getCuratedBscRecognition(
    addresses: string[],
    signal?: AbortSignal,
) {
    const now = Date.now()
    let values = cache?.expiresAt && cache.expiresAt > now
        ? cache.values
        : null
    if (!values) {
        pending ??= refresh(signal).finally(() => {
            pending = null
        })
        values = await pending
    }

    const result = new Map<string, CuratedRecognition>()
    for (const value of addresses) {
        const address = normalizeAddress(value)
        const recognition = address ? values.get(address) : null
        if (address && recognition) result.set(address, recognition)
    }
    return result
}

export function clearCuratedRecognitionCacheForTest() {
    cache = null
    pending = null
}
