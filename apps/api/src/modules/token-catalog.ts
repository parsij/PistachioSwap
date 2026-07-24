import type { FastifyInstance } from 'fastify'

import { NATIVE_TOKEN_ADDRESS, createTokenId } from '../lib/address.js'
import {
    loadFallbackTokenCatalog,
    getFallbackTokensForChain,
} from '../token-discovery/fallback-token-catalog.js'
import {
    type ShapeShiftCatalogToken,
    loadShapeShiftAssetCatalog,
} from '../token-discovery/shapeshift-asset-catalog.js'
import {
    ACTIVE_TOKEN_DISCOVERY_CHAINS,
    getTokenDiscoveryChain,
} from '../token-discovery/registry.js'
import {
    getFeaturedTokenAddresses,
    getFeaturedTokenCountsByChain,
    getTokenCatalogOverride,
    isPoolVaultOrReceiptToken,
} from '../token-discovery/token-catalog-overrides.js'

const MAX_LIMIT = 250
const MAX_CHAIN_LIMIT = 6_000
const DEFAULT_CHAIN_LIMIT = 11

type CatalogQuery = {
    chainId?: string
    search?: string
    limit?: string
    mode?: string
}

function parseChainId(value: string | undefined) {
    if (!value || value.trim().toLowerCase() === 'all') return 'all' as const
    const chainId = Number(value)
    return Number.isSafeInteger(chainId) && getTokenDiscoveryChain(chainId)?.active
        ? chainId
        : null
}

function parseMode(value: string | undefined) {
    const mode = value?.trim().toLowerCase()
    if (!mode || mode === 'featured') return 'featured' as const
    if (mode === 'all') return 'all' as const
    return null
}

function parseLimit(value: string | undefined, mode: 'featured' | 'all') {
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_CHAIN_LIMIT
    return Math.min(parsed, mode === 'all' ? MAX_CHAIN_LIMIT : MAX_LIMIT)
}

function tokenSearchCategory(token: ShapeShiftCatalogToken, query: string) {
    if (!query) return 0
    const override = getTokenCatalogOverride(token.chainId, token.address)
    const address = token.address.toLowerCase()
    const displaySymbol = (override?.displaySymbol ?? token.symbol).toLowerCase()
    const upstreamSymbol = token.symbol.toLowerCase()
    const displayName = (override?.displayName ?? token.name).toLowerCase()
    const aliases = (override?.searchAliases ?? []).map((alias) => alias.toLowerCase())
    const poolLike = isPoolVaultOrReceiptToken(token)
    if (address === query) return 1
    if (displaySymbol === query) return 2
    if (aliases.some((alias) => alias === query)) return 3
    if (upstreamSymbol === query) return 4
    if (displaySymbol.startsWith(query)) return 5
    if (aliases.some((alias) => alias.startsWith(query))) return 6
    if (displayName.startsWith(query)) return 7
    if (displaySymbol.includes(query) || upstreamSymbol.includes(query) || displayName.includes(query) ||
        aliases.some((alias) => alias.includes(query))) return poolLike ? 9 : 8
    return -1
}

function publicToken(token: ShapeShiftCatalogToken, index: number) {
    const override = getTokenCatalogOverride(token.chainId, token.address)
    const poolLike = isPoolVaultOrReceiptToken(token)
    const displayName = override?.displayName ?? token.name
    const displaySymbol = override?.displaySymbol ?? token.symbol
    return {
        id: createTokenId(token.chainId, token.address),
        canonicalId: createTokenId(token.chainId, token.address),
        assetId: token.assetId,
        chainId: token.chainId,
        address: token.address,
        isNative: token.isNative,
        name: displayName,
        symbol: displaySymbol,
        sourceName: displayName === token.name ? undefined : token.name,
        sourceSymbol: displaySymbol === token.symbol ? undefined : token.symbol,
        searchAliases: override?.searchAliases ?? [],
        decimals: token.decimals,
        logoURI: token.icon,
        logoCandidates: [token.icon],
        source: 'shapeshift-local',
        catalogSection: token.isNative ? 'common' : 'catalog',
        rank: index,
        featuredRank: override?.featuredRank ?? null,
        tokenCatalogClass: poolLike ? 'pool-vault-receipt' : 'ordinary',
        recognitionStatus: 'recognized',
        verificationStatus: 'recognized',
        recognitionReasons: ['shapeshift-generated-asset-data'],
        verificationReasons: ['shapeshift-generated-asset-data'],
        possibleSpam: false,
        verifiedContract: token.isNative ? null : true,
        visibility: 'primary',
    }
}

async function legacyFallbackCatalog(chainScope: number | 'all', limit: number, search: string) {
    const fallback = await loadFallbackTokenCatalog().catch(() => null)
    const chainIds = chainScope === 'all'
        ? ACTIVE_TOKEN_DISCOVERY_CHAINS.map((chain) => chain.chainId)
        : [chainScope]
    const tokens = chainIds.flatMap((chainId) =>
        getFallbackTokensForChain(chainId).then((chainTokens) =>
            chainTokens.filter((token) => {
            if (!search) return true
            return [token.address, token.symbol, token.name].some((value) =>
                String(value ?? '').toLowerCase().includes(search))
            }),
        ),
    )
    const resolvedTokens = (await Promise.all(tokens)).flat()
    return {
        schemaVersion: 1,
        generatedAt: null,
        tokens: resolvedTokens.slice(0, limit),
        diagnostics: {
            source: 'legacy-fallback',
            generatedAt: null,
            stale: false,
            count: resolvedTokens.slice(0, limit).length,
            fallbackLoaded: Boolean(fallback),
        },
    }
}

export async function getTokenCatalog({
    chainId,
    search = '',
    limit,
    mode,
}: {
    chainId?: string
    search?: string
    limit?: string
    mode?: string
}) {
    const chainScope = parseChainId(chainId)
    if (chainScope === null) {
        return { statusCode: 400, body: { error: { code: 'INVALID_CHAIN_ID' } } }
    }
    const catalogMode = parseMode(mode)
    if (catalogMode === null) {
        return { statusCode: 400, body: { error: { code: 'INVALID_MODE' } } }
    }
    const normalizedSearch = search.trim().toLowerCase()
    const requestedLimit = parseLimit(limit, catalogMode)
    const loaded = await loadShapeShiftAssetCatalog()
    if (!loaded.catalog) {
        return {
            statusCode: 200,
            body: await legacyFallbackCatalog(chainScope, requestedLimit, normalizedSearch),
        }
    }

    const ranked = loaded.catalog.ids
        .map((id, index) => ({ token: loaded.catalog!.byId[id], index }))
        .filter(({ token }) => chainScope === 'all' || token.chainId === chainScope)
        .map((entry) => ({
            ...entry,
            category: tokenSearchCategory(entry.token, normalizedSearch),
            featuredRank: getTokenCatalogOverride(entry.token.chainId, entry.token.address)?.featuredRank ?? null,
            poolLike: isPoolVaultOrReceiptToken(entry.token),
        }))
        .filter(({ category }) => normalizedSearch ? category >= 0 : true)
        .sort((left, right) =>
            left.category - right.category ||
            Number(left.featuredRank ?? 9999) - Number(right.featuredRank ?? 9999) ||
            Number(left.poolLike) - Number(right.poolLike) ||
            left.index - right.index)
    if (ranked.length === 0 && chainScope !== 'all') {
        return {
            statusCode: 200,
            body: await legacyFallbackCatalog(chainScope, requestedLimit, normalizedSearch),
        }
    }

    let selected = ranked
    if (!normalizedSearch && catalogMode === 'featured') {
        if (chainScope === 'all') {
            selected = ACTIVE_TOKEN_DISCOVERY_CHAINS.flatMap((chain) =>
                featuredTokensForChain(ranked, chain.chainId),
            ).slice(0, requestedLimit)
        } else {
            selected = featuredTokensForChain(ranked, chainScope)
                .slice(0, Math.min(requestedLimit, DEFAULT_CHAIN_LIMIT))
        }
    } else {
        selected = ranked.slice(0, requestedLimit)
    }
    const tokens = selected.map(({ token, index }) => publicToken(token, index))
    return {
        statusCode: 200,
        body: {
            schemaVersion: 1,
            generatedAt: loaded.catalog.generatedAt,
            source: loaded.catalog.source,
            tokens,
            diagnostics: {
                source: 'shapeshift-local',
                generatedAt: loaded.catalog.generatedAt,
                stale: false,
                count: tokens.length,
                mode: catalogMode,
                featuredCounts: getFeaturedTokenCountsByChain(),
            },
        },
    }
}

function featuredTokensForChain<T extends {
    token: ShapeShiftCatalogToken
    index: number
    poolLike: boolean
}>(entries: T[], chainId: number) {
    const chain = getTokenDiscoveryChain(chainId)
    if (!chain?.active) return []
    const scoped = entries.filter(({ token }) => token.chainId === chainId)
    const byAddress = new Map(scoped.map((entry) => [entry.token.address, entry]))
    const native = byAddress.get(NATIVE_TOKEN_ADDRESS)
    const featured = getFeaturedTokenAddresses(chain)
        .map((address, index) => ({ entry: byAddress.get(address), index }))
        .filter((item): item is { entry: T; index: number } => {
            const entry = item.entry
            return Boolean(entry) &&
                !entry!.poolLike &&
                getTokenCatalogOverride(chainId, entry!.token.address)?.hiddenFromFeatured !== true
        })
        .sort((left, right) =>
            Number(getTokenCatalogOverride(chainId, left.entry.token.address)?.featuredRank ?? left.index) -
            Number(getTokenCatalogOverride(chainId, right.entry.token.address)?.featuredRank ?? right.index))
        .map(({ entry }) => entry)
    return native ? [native, ...featured.slice(0, 10)] : featured.slice(0, 10)
}

export async function tokenCatalogRoutes(app: FastifyInstance) {
    app.get('/v1/token-catalog', async (request, reply) => {
        const result = await getTokenCatalog(request.query as CatalogQuery)
        return reply.code(result.statusCode).send(result.body)
    })
}
