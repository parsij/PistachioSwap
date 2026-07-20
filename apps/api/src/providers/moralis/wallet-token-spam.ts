import { getApiConfig } from '../../config.js'
import { normalizeAddress } from '../../lib/address.js'
import { setBoundedCacheEntry } from '../../lib/bounded-cache.js'
import {
    isRecord,
    validateRemoteImageUrl,
} from '../../lib/http.js'
import { moralisWalletTokensRequest } from './moralis-client.js'
import { tokenDiscoveryContext } from '../../token-discovery/context.js'
import type {
    MoralisWalletToken,
    MoralisWalletTokenResult,
} from './types.js'

const MAX_PAGES = 20

type CacheEntry = {
    expiresAt: number
    result: MoralisWalletTokenResult
}

type Dependencies = {
    requestPage: typeof moralisWalletTokensRequest
    now: () => number
}

const cache = new Map<string, CacheEntry>()
const pending = new Map<string, Promise<MoralisWalletTokenResult>>()

function nullableBoolean(value: unknown) {
    if (value === true || value === 'true') return true
    if (value === false || value === 'false') return false
    return null
}

function nullableText(value: unknown, maximum: number) {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized && normalized.length <= maximum ? normalized : null
}

function nullableDecimals(value: unknown) {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255
        ? parsed
        : null
}

function nullableDecimal(value: unknown) {
    if (value === null || value === undefined || value === '') return null
    const normalized = String(value).trim()
    return /^\d+(?:\.\d+)?$/.test(normalized) ? normalized : null
}

export function normalizeMoralisWalletToken(
    value: unknown,
): MoralisWalletToken | null {
    if (!isRecord(value) || value.native_token === true) return null
    const address = normalizeAddress(value.token_address)
    if (!address) return null

    return {
        chainId: 56,
        address,
        possibleSpam: nullableBoolean(value.possible_spam),
        verifiedContract: nullableBoolean(value.verified_contract),
        name: nullableText(value.name, 120),
        symbol: nullableText(value.symbol, 32),
        decimals: nullableDecimals(value.decimals),
        logoURI: validateRemoteImageUrl(value.logo) ??
            validateRemoteImageUrl(value.thumbnail),
        priceUSD: nullableDecimal(value.usd_price),
        valueUSD: nullableDecimal(value.usd_value),
        source: 'moralis',
    }
}

function unavailableResult(): MoralisWalletTokenResult {
    return {
        available: false,
        checkedAt: null,
        tokens: new Map(),
        pageCount: 0,
    }
}

export function createMoralisWalletTokenService(
    overrides: Partial<Dependencies> = {},
) {
    const dependencies: Dependencies = {
        requestPage: moralisWalletTokensRequest,
        now: Date.now,
        ...overrides,
    }

    async function getWalletTokens(
        walletAddress: string,
        signal?: AbortSignal,
        chainId = 56,
    ): Promise<MoralisWalletTokenResult> {
        const wallet = normalizeAddress(walletAddress)
        if (!wallet) return unavailableResult()

        const config = getApiConfig().moralis
        const context = tokenDiscoveryContext(chainId)
        if (!context.chain.capabilities.moralis) return unavailableResult()
        if (!config.enabled || !config.apiKey) return unavailableResult()

        const key = `${chainId}:${wallet}`
        const existing = cache.get(key)
        const now = dependencies.now()
        if (existing && existing.expiresAt > now) return existing.result

        const inFlight = pending.get(key)
        if (inFlight) return inFlight

        const request = (async () => {
            const tokens = new Map<string, MoralisWalletToken>()
            const seenCursors = new Set<string>()
            let cursor: string | null = null
            let pageCount = 0

            try {
                do {
                    const payload = await dependencies.requestPage({
                        chainId,
                        walletAddress: wallet,
                        cursor,
                        signal,
                    })
                    if (!isRecord(payload) || !Array.isArray(payload.result)) {
                        throw new Error('Moralis returned an invalid wallet-token response.')
                    }
                    pageCount += 1
                    for (const value of payload.result) {
                        const token = normalizeMoralisWalletToken(value)
                        if (token) tokens.set(token.address, token)
                    }

                    const nextCursor = typeof payload.cursor === 'string' &&
                        payload.cursor.trim()
                        ? payload.cursor.trim()
                        : null
                    if (!nextCursor || seenCursors.has(nextCursor)) break
                    seenCursors.add(nextCursor)
                    cursor = nextCursor
                } while (pageCount < MAX_PAGES)

                const result: MoralisWalletTokenResult = {
                    available: true,
                    checkedAt: new Date(dependencies.now()).toISOString(),
                    tokens,
                    pageCount,
                }
                setBoundedCacheEntry(cache, key, {
                    result,
                    expiresAt: dependencies.now() + config.cacheTtlMs,
                }, 1_000)
                return result
            } catch {
                const result = existing?.result ?? unavailableResult()
                if (!signal?.aborted) {
                    setBoundedCacheEntry(cache, key, {
                        result,
                        expiresAt: dependencies.now() + config.cacheTtlMs,
                    }, 1_000)
                }
                return result
            }
        })()

        pending.set(key, request)
        try {
            return await request
        } finally {
            if (pending.get(key) === request) pending.delete(key)
        }
    }

    return { getWalletTokens }
}

export const moralisWalletTokenService = createMoralisWalletTokenService()

export function clearMoralisWalletTokenCacheForTest() {
    cache.clear()
    pending.clear()
}
