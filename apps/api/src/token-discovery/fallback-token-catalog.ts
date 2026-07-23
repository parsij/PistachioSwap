import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
    NATIVE_TOKEN_ADDRESS,
    createTokenId,
    normalizeAddress,
} from '../lib/address.js'
import {
    ACTIVE_TOKEN_DISCOVERY_CHAINS,
    canonicalTokenAddress,
    getTokenDiscoveryChain,
} from './registry.js'
import { FALLBACK_TOKEN_MAX_ADDRESSES_PER_CHAIN } from './fallback-token-addresses.js'

export const FALLBACK_TOKEN_CATALOG_PATH = fileURLToPath(
    new URL('../../data/fallback-token-catalog.v1.json', import.meta.url),
)

export type FallbackTokenCatalogRecord = {
    chainId: number
    address: string
    name: string
    symbol: string
    decimals: number
    logoURI: string
    logoCandidates: string[]
    coinGeckoId: string | null
    metadataSources: string[]
    iconSource: string | null
    generatedAt: string
    catalogSource: 'static-fallback'
    directoryStatus: 'listed'
}

export type PublicFallbackToken = FallbackTokenCatalogRecord & {
    id: string
    canonicalId: string
    chainLogoURI: string | null
    catalogSection: 'fallback'
    rank: null
    isNative?: boolean
}

type LoaderOptions = {
    path?: string
    allowEmptyForTest?: boolean
    recordsForTest?: unknown
}

let cachedCatalog: {
    path: string
    records: FallbackTokenCatalogRecord[]
    byChain: Map<number, FallbackTokenCatalogRecord[]>
    byIdentity: Map<string, FallbackTokenCatalogRecord>
} | null = null

function boundedText(value: unknown, maximum: number) {
    const text = typeof value === 'string' ? value.trim() : ''
    return text && text.length <= maximum ? text : null
}

export function validateFallbackTokenCatalogRecords(
    value: unknown,
): FallbackTokenCatalogRecord[] {
    if (!Array.isArray(value)) {
        throw new Error('Fallback token catalog must be an array.')
    }
    const seen = new Set<string>()
    const counts = new Map<number, number>()
    return value.map((entry, index) => {
        if (typeof entry !== 'object' || entry === null) {
            throw new Error(`Fallback token catalog record ${index} is malformed.`)
        }
        const record = entry as Partial<FallbackTokenCatalogRecord>
        const chain = getTokenDiscoveryChain(Number(record.chainId))
        const address = normalizeAddress(record.address)
        const name = boundedText(record.name, 120)
        const symbol = boundedText(record.symbol, 32)
        if (!chain?.active || !address || address === NATIVE_TOKEN_ADDRESS) {
            throw new Error(`Fallback token catalog record ${index} has an invalid identity.`)
        }
        const identity = createTokenId(chain.chainId, address)
        if (seen.has(identity)) {
            throw new Error(`Duplicate fallback token catalog identity: ${identity}`)
        }
        seen.add(identity)
        counts.set(chain.chainId, (counts.get(chain.chainId) ?? 0) + 1)
        if ((counts.get(chain.chainId) ?? 0) > FALLBACK_TOKEN_MAX_ADDRESSES_PER_CHAIN) {
            throw new Error(`Fallback token catalog chain ${chain.chainId} exceeds 100 records.`)
        }
        if (!name || !symbol ||
            !Number.isInteger(record.decimals) ||
            Number(record.decimals) < 0 ||
            Number(record.decimals) > 255 ||
            typeof record.logoURI !== 'string' ||
            !record.logoURI.startsWith('/') ||
            !Array.isArray(record.logoCandidates) ||
            !record.logoCandidates.every((url) => typeof url === 'string') ||
            !(record.coinGeckoId === null || typeof record.coinGeckoId === 'string') ||
            !Array.isArray(record.metadataSources) ||
            !record.metadataSources.every((source) => typeof source === 'string') ||
            !(record.iconSource === null || typeof record.iconSource === 'string') ||
            Number.isNaN(Date.parse(String(record.generatedAt))) ||
            record.catalogSource !== 'static-fallback' ||
            record.directoryStatus !== 'listed'
        ) {
            throw new Error(`Fallback token catalog record ${index} has invalid metadata.`)
        }
        for (const forbidden of [
            'priceUSD',
            'trustedPriceUSD',
            'marketPriceUSD',
            'liquidityUsd',
            'volume24hUsd',
            'transactionCount24h',
            'uniqueTraders24h',
            'classificationTier',
            'includeInPortfolioValue',
            'rank',
        ]) {
            if (forbidden in record) {
                throw new Error(`Fallback token catalog record ${index} contains ${forbidden}.`)
            }
        }
        return {
            chainId: chain.chainId,
            address,
            name,
            symbol,
            decimals: Number(record.decimals),
            logoURI: record.logoURI,
            logoCandidates: [...new Set(record.logoCandidates)],
            coinGeckoId: record.coinGeckoId ?? null,
            metadataSources: [...new Set(record.metadataSources)],
            iconSource: record.iconSource ?? null,
            generatedAt: new Date(String(record.generatedAt)).toISOString(),
            catalogSource: 'static-fallback',
            directoryStatus: 'listed',
        }
    })
}

function createPublicFallbackRecord(
    record: FallbackTokenCatalogRecord,
): PublicFallbackToken {
    const canonicalAddress = canonicalTokenAddress(record.chainId, record.address)
    const chain = getTokenDiscoveryChain(record.chainId)
    const canonicalId = createTokenId(record.chainId, canonicalAddress)
    const logoCandidates = [...new Set([
        ...record.logoCandidates,
        record.logoURI,
        '/icons/token-fallback.svg',
    ].filter((value) => typeof value === 'string' && value.length > 0))]
    return {
        ...record,
        id: canonicalId,
        canonicalId,
        address: canonicalAddress,
        logoURI: logoCandidates[0] ?? '/icons/token-fallback.svg',
        logoCandidates,
        chainLogoURI: chain?.chainLogoURI ?? null,
        catalogSource: 'static-fallback',
        directoryStatus: 'listed',
        catalogSection: 'fallback',
        rank: null,
    }
}

function nativeFallbackTokens(chainId: number): PublicFallbackToken[] {
    const chain = getTokenDiscoveryChain(chainId)
    if (!chain?.active) return []
    const generatedAt = new Date(0).toISOString()
    return [
        {
            chainId,
            address: NATIVE_TOKEN_ADDRESS,
            name: chain.native.name,
            symbol: chain.native.symbol,
            decimals: chain.native.decimals,
            logoURI: chain.chainLogoURI,
            logoCandidates: [chain.chainLogoURI, '/icons/token-fallback.svg'],
            coinGeckoId: chain.native.coinGeckoId,
            metadataSources: ['active-chain-registry'],
            iconSource: 'local',
            generatedAt,
            catalogSource: 'static-fallback',
            directoryStatus: 'listed',
            id: createTokenId(chainId, NATIVE_TOKEN_ADDRESS),
            canonicalId: createTokenId(chainId, NATIVE_TOKEN_ADDRESS),
            chainLogoURI: chain.chainLogoURI,
            catalogSection: 'fallback',
            rank: null,
            isNative: true,
        },
        createPublicFallbackRecord({
            chainId,
            address: chain.wrappedNative.address,
            name: chain.wrappedNative.name,
            symbol: chain.wrappedNative.symbol,
            decimals: chain.wrappedNative.decimals,
            logoURI: '/icons/token-fallback.svg',
            logoCandidates: ['/icons/token-fallback.svg'],
            coinGeckoId: null,
            metadataSources: ['active-chain-registry'],
            iconSource: null,
            generatedAt,
            catalogSource: 'static-fallback',
            directoryStatus: 'listed',
        }),
    ]
}

function staticFallbackSortRank(token: PublicFallbackToken) {
    const symbol = token.symbol.toUpperCase()
    if (token.address === NATIVE_TOKEN_ADDRESS || token.isNative) return 0
    const chain = getTokenDiscoveryChain(token.chainId)
    if (chain && token.address === chain.wrappedNative.address) return 1
    if (['USDC', 'USDT', 'DAI', 'FRAX', 'LUSD', 'USDE', 'SUSDE'].includes(symbol)) return 2
    if (['WBTC', 'BTCB', 'TBTC', 'CBTC'].includes(symbol) || symbol.includes('BTC')) return 3
    if (['UNI', 'AAVE', 'CAKE', 'COMP', 'OP', 'ARB', 'MKR', 'SKY'].includes(symbol)) return 4
    return 5
}

function loadFromRecords(records: FallbackTokenCatalogRecord[], path: string) {
    const byChain = new Map<number, FallbackTokenCatalogRecord[]>()
    const byIdentity = new Map<string, FallbackTokenCatalogRecord>()
    for (const record of records) {
        const key = createTokenId(record.chainId, record.address)
        byIdentity.set(key, record)
        byChain.set(record.chainId, [...(byChain.get(record.chainId) ?? []), record])
    }
    cachedCatalog = { path, records, byChain, byIdentity }
    return cachedCatalog
}

export async function loadFallbackTokenCatalog(options: LoaderOptions = {}) {
    const path = options.path ?? FALLBACK_TOKEN_CATALOG_PATH
    if (!options.recordsForTest && cachedCatalog?.path === path) return cachedCatalog
    if (options.recordsForTest !== undefined) {
        return loadFromRecords(
            validateFallbackTokenCatalogRecords(options.recordsForTest),
            path,
        )
    }
    try {
        const parsed = JSON.parse(await readFile(path, 'utf8'))
        return loadFromRecords(validateFallbackTokenCatalogRecords(parsed), path)
    } catch (error) {
        if (options.allowEmptyForTest && process.env.NODE_ENV === 'test') {
            return loadFromRecords([], path)
        }
        throw error
    }
}

export function resetFallbackTokenCatalogCacheForTest() {
    cachedCatalog = null
}

export async function getFallbackTokensForChain(chainId: number) {
    const catalog = await loadFallbackTokenCatalog()
    const seen = new Set<string>()
    const sourceOrder = new Map(
        (catalog.byChain.get(chainId) ?? []).map((record, index) => [
            createTokenId(record.chainId, record.address),
            index,
        ]),
    )
    const tokens = [
        ...nativeFallbackTokens(chainId).map((token, index) => ({ token, index: -2 + index })),
        ...(catalog.byChain.get(chainId) ?? [])
            .map(createPublicFallbackRecord)
            .map((token) => ({ token, index: sourceOrder.get(token.canonicalId) ?? 9999 })),
    ].filter(({ token }) => {
        const key = createTokenId(token.chainId, token.address)
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
    return tokens.toSorted((left, right) =>
        staticFallbackSortRank(left.token) - staticFallbackSortRank(right.token) ||
        left.index - right.index ||
        String(left.token.address).localeCompare(String(right.token.address)),
    ).map(({ token }) => token).slice(0, FALLBACK_TOKEN_MAX_ADDRESSES_PER_CHAIN + 2)
}

export async function getFallbackToken(chainId: number, address: string) {
    const normalized = normalizeAddress(address)
    if (!normalized) return null
    const canonical = canonicalTokenAddress(chainId, normalized)
    return (await getFallbackTokensForChain(chainId))
        .find((token) => token.address === canonical) ?? null
}

export async function getFallbackTokensForAllChains() {
    const values = await Promise.all(
        ACTIVE_TOKEN_DISCOVERY_CHAINS.map((chain) =>
            getFallbackTokensForChain(chain.chainId)),
    )
    return values.flat()
}
