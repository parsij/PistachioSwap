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
    TOKEN_CATALOG_SUPPLEMENTS,
    type TokenCatalogSupplement,
} from '../token-discovery/token-catalog-supplements.js'
import {
    ACTIVE_TOKEN_DISCOVERY_CHAINS,
    type TokenDiscoveryChain,
    getTokenDiscoveryChain,
} from '../token-discovery/registry.js'
import {
    getFeaturedTokenAddresses,
    getFeaturedTokenCountsByChain,
    getTokenCatalogOverride,
    isPoolVaultOrReceiptToken,
} from '../token-discovery/token-catalog-overrides.js'

const MAX_LIMIT = 250
const DEFAULT_CHAIN_LIMIT = 11
const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 100
const MAX_SEARCH_RESULTS = 20
const DEFAULT_ALL_CHAIN_FEATURED_LIMIT = 48

const ALL_CHAIN_COMMON_SYMBOLS = [
    'USDC',
    'USDT',
    'DAI',
    'WETH',
    'WBTC',
    'WBNB',
    'WPOL',
    'WAVAX',
    'WXDAI',
    'CELO',
    'MNT',
    'BERA',
    'AERO',
    'CAKE',
    'LINK',
    'AAVE',
] as const

const CURSOR_VERSION = 1

type CatalogToken = ShapeShiftCatalogToken | TokenCatalogSupplement

type CatalogQuery = {
    chainId?: string
    search?: string
    limit?: string
    mode?: string
    pageSize?: string
    cursor?: string
}

type CatalogCursor = {
    v: number
    scope: string
    offset: number
}

type CatalogRankedEntry = {
    token: CatalogToken
    index: number
    category: number
    featuredRank: number | null
    poolLike: boolean
}

type AllChainSelection =
    | { kind: 'catalog'; entry: CatalogRankedEntry }
    | { kind: 'registry-native'; chain: TokenDiscoveryChain; index: number }

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

function parseLimit(value: string | undefined) {
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_CHAIN_LIMIT
    return Math.min(parsed, MAX_LIMIT)
}

function parsePageSize(value: string | undefined) {
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE
    return Math.min(parsed, MAX_PAGE_SIZE)
}

function encodeCursor(scope: number | 'all', offset: number) {
    const payload: CatalogCursor = {
        v: CURSOR_VERSION,
        scope: String(scope),
        offset,
    }
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodeCursor(value: string | undefined, scope: number | 'all') {
    if (!value) return 0
    try {
        const decoded = JSON.parse(
            Buffer.from(value, 'base64url').toString('utf8'),
        ) as Partial<CatalogCursor>
        if (
            decoded.v !== CURSOR_VERSION ||
            decoded.scope !== String(scope) ||
            !Number.isSafeInteger(decoded.offset) ||
            Number(decoded.offset) < 0
        ) {
            return null
        }
        return Number(decoded.offset)
    } catch {
        return null
    }
}

function tokenAliases(token: CatalogToken) {
    const overrideAliases = getTokenCatalogOverride(token.chainId, token.address)?.searchAliases ?? []
    const supplementAliases = token.source === 'supplement' ? token.searchAliases : []
    return [...new Set([...overrideAliases, ...supplementAliases])]
}

function tokenDisplaySymbol(token: CatalogToken) {
    return (getTokenCatalogOverride(token.chainId, token.address)?.displaySymbol ?? token.symbol)
        .trim()
        .toUpperCase()
}

function tokenSearchCategory(token: CatalogToken, query: string) {
    if (!query) return 0
    const override = getTokenCatalogOverride(token.chainId, token.address)
    const address = token.address.toLowerCase()
    const displaySymbol = (override?.displaySymbol ?? token.symbol).toLowerCase()
    const upstreamSymbol = token.symbol.toLowerCase()
    const displayName = (override?.displayName ?? token.name).toLowerCase()
    const aliases = tokenAliases(token).map((alias) => alias.toLowerCase())
    const chainName = getTokenDiscoveryChain(token.chainId)?.name.toLowerCase() ?? ''
    const poolLike = isPoolVaultOrReceiptToken(token)
    if (address === query) return 1
    if (displaySymbol === query) return 2
    if (aliases.some((alias) => alias === query)) return 3
    if (upstreamSymbol === query) return 4
    if (displaySymbol.startsWith(query)) return 5
    if (aliases.some((alias) => alias.startsWith(query))) return 6
    if (displayName.startsWith(query)) return 7
    if (
        displaySymbol.includes(query) ||
        upstreamSymbol.includes(query) ||
        displayName.includes(query) ||
        aliases.some((alias) => alias.includes(query)) ||
        chainName.includes(query)
    ) return poolLike ? 9 : 8
    return -1
}

function compareRankedEntries(left: CatalogRankedEntry, right: CatalogRankedEntry) {
    return left.category - right.category ||
        Number(left.featuredRank ?? 9999) - Number(right.featuredRank ?? 9999) ||
        Number(left.poolLike) - Number(right.poolLike) ||
        left.index - right.index
}

function balancedAllChainSearch(entries: readonly CatalogRankedEntry[], limit: number) {
    const bestByChain = new Map<number, CatalogRankedEntry>()
    for (const entry of entries) {
        if (!bestByChain.has(entry.token.chainId)) {
            bestByChain.set(entry.token.chainId, entry)
        }
    }

    const selected = [...bestByChain.values()].sort(compareRankedEntries)
    const selectedIds = new Set(selected.map((entry) =>
        createTokenId(entry.token.chainId, entry.token.address)))
    for (const entry of entries) {
        if (selected.length >= limit) break
        const identity = createTokenId(entry.token.chainId, entry.token.address)
        if (selectedIds.has(identity)) continue
        selectedIds.add(identity)
        selected.push(entry)
    }
    return selected.slice(0, limit)
}

function catalogIdentityIndex(tokens: readonly CatalogToken[]) {
    const index = new Map<string, CatalogToken>()
    for (const token of tokens) {
        index.set(createTokenId(token.chainId, token.address), token)
    }
    return index
}

function uniqueLogoCandidates(values: readonly (string | null | undefined)[]) {
    return values.filter((value, index, candidates): value is string =>
        typeof value === 'string' && value.length > 0 && candidates.indexOf(value) === index)
}

function tokenLogoCandidates(
    token: CatalogToken,
    identityIndex: ReadonlyMap<string, CatalogToken>,
) {
    const chain = getTokenDiscoveryChain(token.chainId)
    const candidates: (string | null | undefined)[] = []

    if (chain && token.address === chain.wrappedNative.address) {
        const wrappedSymbol = chain.wrappedNative.symbol.toLowerCase()
        for (const candidateChain of ACTIVE_TOKEN_DISCOVERY_CHAINS) {
            if (candidateChain.wrappedNative.symbol.toLowerCase() !== wrappedSymbol) continue
            candidates.push(identityIndex.get(createTokenId(
                candidateChain.chainId,
                candidateChain.wrappedNative.address,
            ))?.icon)
        }
        candidates.push(token.icon, chain.chainLogoURI)
    } else {
        candidates.push(token.icon)
        if (token.isNative) candidates.push(chain?.chainLogoURI)
    }

    return uniqueLogoCandidates(candidates)
}

function chainQualifiedName(token: CatalogToken, displayName: string, includeChainName: boolean) {
    if (!includeChainName) return displayName
    const chain = getTokenDiscoveryChain(token.chainId)
    if (!chain) return displayName
    const isWrappedNative = token.address === chain.wrappedNative.address
    if (!token.isNative && !isWrappedNative) return displayName
    return displayName.toLowerCase().includes(chain.name.toLowerCase())
        ? displayName
        : `${displayName} (${chain.name})`
}

function publicToken(
    token: CatalogToken,
    index: number,
    identityIndex: ReadonlyMap<string, CatalogToken>,
    includeChainName = false,
) {
    const override = getTokenCatalogOverride(token.chainId, token.address)
    const poolLike = isPoolVaultOrReceiptToken(token)
    const originalDisplayName = override?.displayName ?? token.name
    const displayName = chainQualifiedName(token, originalDisplayName, includeChainName)
    const displaySymbol = override?.displaySymbol ?? token.symbol
    const logoCandidates = tokenLogoCandidates(token, identityIndex)
    const supplement = token.source === 'supplement'
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
        searchAliases: tokenAliases(token),
        decimals: token.decimals,
        logoURI: logoCandidates[0] ?? null,
        logoCandidates,
        source: supplement ? 'catalog-supplement' : 'shapeshift-local',
        catalogSection: token.isNative ? 'common' : 'catalog',
        rank: index,
        featuredRank: override?.featuredRank ?? null,
        tokenCatalogClass: poolLike ? 'pool-vault-receipt' : 'ordinary',
        recognitionStatus: supplement ? 'established' : 'recognized',
        verificationStatus: supplement ? 'established' : 'recognized',
        recognitionReasons: [supplement
            ? 'official-catalog-supplement'
            : 'shapeshift-generated-asset-data'],
        verificationReasons: [supplement
            ? 'official-catalog-supplement'
            : 'shapeshift-generated-asset-data'],
        possibleSpam: false,
        verifiedContract: token.isNative ? null : true,
        visibility: 'primary',
    }
}

function publicRegistryNativeToken(chain: TokenDiscoveryChain, index: number) {
    return {
        id: createTokenId(chain.chainId, NATIVE_TOKEN_ADDRESS),
        canonicalId: createTokenId(chain.chainId, NATIVE_TOKEN_ADDRESS),
        assetId: `eip155:${chain.chainId}/slip44:60`,
        chainId: chain.chainId,
        address: NATIVE_TOKEN_ADDRESS,
        isNative: true,
        name: `${chain.native.name} (${chain.name})`,
        symbol: chain.native.symbol,
        searchAliases: [chain.name],
        decimals: chain.native.decimals,
        logoURI: chain.chainLogoURI,
        logoCandidates: [chain.chainLogoURI],
        source: 'registry-native',
        catalogSection: 'common',
        rank: index,
        featuredRank: 0,
        tokenCatalogClass: 'ordinary',
        recognitionStatus: 'established',
        verificationStatus: 'established',
        recognitionReasons: ['active-chain-registry-native'],
        verificationReasons: ['active-chain-registry-native'],
        possibleSpam: false,
        verifiedContract: null,
        visibility: 'primary',
    }
}

type PublicCatalogToken =
    | ReturnType<typeof publicToken>
    | ReturnType<typeof publicRegistryNativeToken>

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
    const selected = resolvedTokens.slice(0, Math.min(limit, search ? MAX_SEARCH_RESULTS : limit))
    return {
        schemaVersion: 1,
        generatedAt: null,
        tokens: selected,
        nextCursor: null,
        hasMore: false,
        diagnostics: {
            source: 'legacy-fallback',
            generatedAt: null,
            stale: false,
            count: selected.length,
            returned: selected.length,
            totalForChain: resolvedTokens.length,
            fallbackLoaded: Boolean(fallback),
        },
    }
}

function uniqueRankedEntries(entries: readonly CatalogRankedEntry[]) {
    const selected = new Map<string, CatalogRankedEntry>()
    for (const entry of entries) {
        selected.set(createTokenId(entry.token.chainId, entry.token.address), entry)
    }
    return [...selected.values()]
}

function allChainCandidatesForChain(entries: readonly CatalogRankedEntry[], chain: TokenDiscoveryChain) {
    const scoped = entries.filter(({ token }) => token.chainId === chain.chainId && !isPoolVaultOrReceiptToken(token))
    const common = ALL_CHAIN_COMMON_SYMBOLS.flatMap((symbol) => {
        const match = scoped.find(({ token }) => tokenDisplaySymbol(token) === symbol)
        return match ? [match] : []
    })
    return uniqueRankedEntries([
        ...common,
        ...featuredTokensForChain(entries, chain.chainId),
        ...scoped.slice(0, 12),
    ])
}

function mixedFeaturedSelectionsForAll(entries: readonly CatalogRankedEntry[], limit: number) {
    const candidates = ACTIVE_TOKEN_DISCOVERY_CHAINS.map((chain) => ({
        chain,
        entries: allChainCandidatesForChain(entries, chain),
    }))
    const selections: AllChainSelection[] = []
    const selectedIds = new Set<string>()
    const usedSymbols = new Set<string>()

    const selectEntry = (entry: CatalogRankedEntry) => {
        const identity = createTokenId(entry.token.chainId, entry.token.address)
        if (selectedIds.has(identity)) return false
        selectedIds.add(identity)
        usedSymbols.add(tokenDisplaySymbol(entry.token))
        selections.push({ kind: 'catalog', entry })
        return true
    }

    for (const { chain, entries: chainEntries } of candidates) {
        if (selections.length >= limit) break
        const uniqueSymbolEntry = chainEntries.find((entry) =>
            !usedSymbols.has(tokenDisplaySymbol(entry.token)))
        const selected = uniqueSymbolEntry ?? chainEntries[0]
        if (selected) {
            selectEntry(selected)
        } else {
            selections.push({
                kind: 'registry-native',
                chain,
                index: Number.MAX_SAFE_INTEGER - chain.chainId,
            })
            usedSymbols.add(chain.native.symbol.toUpperCase())
        }
    }

    let madeProgress = true
    while (selections.length < limit && madeProgress) {
        madeProgress = false
        for (const { entries: chainEntries } of candidates) {
            if (selections.length >= limit) break
            const uniqueSymbolEntry = chainEntries.find((entry) =>
                !selectedIds.has(createTokenId(entry.token.chainId, entry.token.address)) &&
                !usedSymbols.has(tokenDisplaySymbol(entry.token)))
            const nextEntry = uniqueSymbolEntry ?? chainEntries.find((entry) =>
                !selectedIds.has(createTokenId(entry.token.chainId, entry.token.address)))
            if (nextEntry && selectEntry(nextEntry)) madeProgress = true
        }
    }

    return selections
}

export async function getTokenCatalog({
    chainId,
    search = '',
    limit,
    mode,
    pageSize,
    cursor,
}: {
    chainId?: string
    search?: string
    limit?: string
    mode?: string
    pageSize?: string
    cursor?: string
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
    const requestedLimit = limit === undefined && chainScope === 'all' && !normalizedSearch
        ? DEFAULT_ALL_CHAIN_FEATURED_LIMIT
        : parseLimit(limit)
    const loaded = await loadShapeShiftAssetCatalog()
    if (!loaded.catalog) {
        return {
            statusCode: 200,
            body: await legacyFallbackCatalog(chainScope, requestedLimit, normalizedSearch),
        }
    }

    const baseTokens = loaded.catalog.ids.map((id) => loaded.catalog!.byId[id])
    const knownIdentities = new Set(baseTokens.map((token) =>
        createTokenId(token.chainId, token.address)))
    const supplements = TOKEN_CATALOG_SUPPLEMENTS.filter((token) => {
        const identity = createTokenId(token.chainId, token.address)
        if (knownIdentities.has(identity)) return false
        knownIdentities.add(identity)
        return true
    })
    const catalogTokens: CatalogToken[] = [...baseTokens, ...supplements]
    const identityIndex = catalogIdentityIndex(catalogTokens)
    const ranked: CatalogRankedEntry[] = catalogTokens
        .map((token, index) => ({ token, index }))
        .filter(({ token }) => chainScope === 'all' || token.chainId === chainScope)
        .map((entry) => ({
            ...entry,
            category: tokenSearchCategory(entry.token, normalizedSearch),
            featuredRank: getTokenCatalogOverride(entry.token.chainId, entry.token.address)?.featuredRank ?? null,
            poolLike: isPoolVaultOrReceiptToken(entry.token),
        }))
        .filter(({ category }) => normalizedSearch ? category >= 0 : true)
        .sort(compareRankedEntries)
    if (ranked.length === 0 && chainScope !== 'all') {
        return {
            statusCode: 200,
            body: await legacyFallbackCatalog(chainScope, requestedLimit, normalizedSearch),
        }
    }

    let selected = ranked
    let tokens: PublicCatalogToken[] | null = null
    let nextCursor: string | null = null
    let hasMore = false
    let effectivePageSize: number | null = null

    if (normalizedSearch) {
        const searchLimit = Math.min(requestedLimit, MAX_SEARCH_RESULTS)
        selected = chainScope === 'all'
            ? balancedAllChainSearch(ranked, searchLimit)
            : ranked.slice(0, searchLimit)
    } else if (catalogMode === 'featured') {
        if (chainScope === 'all') {
            tokens = mixedFeaturedSelectionsForAll(ranked, requestedLimit).map((selection) =>
                selection.kind === 'catalog'
                    ? publicToken(selection.entry.token, selection.entry.index, identityIndex, true)
                    : publicRegistryNativeToken(selection.chain, selection.index))
        } else {
            selected = featuredTokensForChain(ranked, chainScope)
                .slice(0, Math.min(requestedLimit, DEFAULT_CHAIN_LIMIT))
        }
    } else {
        const offset = decodeCursor(cursor, chainScope)
        if (offset === null) {
            return { statusCode: 400, body: { error: { code: 'INVALID_CURSOR' } } }
        }
        effectivePageSize = parsePageSize(pageSize ?? limit)
        selected = ranked.slice(offset, offset + effectivePageSize)
        const nextOffset = offset + selected.length
        hasMore = nextOffset < ranked.length
        nextCursor = hasMore ? encodeCursor(chainScope, nextOffset) : null
    }

    const publicTokens: PublicCatalogToken[] = tokens ?? selected.map(({ token, index }) =>
        publicToken(token, index, identityIndex, chainScope === 'all'))
    return {
        statusCode: 200,
        body: {
            schemaVersion: 1,
            generatedAt: loaded.catalog.generatedAt,
            source: loaded.catalog.source,
            tokens: publicTokens,
            nextCursor,
            hasMore,
            diagnostics: {
                source: 'shapeshift-local',
                generatedAt: loaded.catalog.generatedAt,
                stale: false,
                count: publicTokens.length,
                returned: publicTokens.length,
                totalForChain: ranked.length,
                pageSize: effectivePageSize,
                mode: catalogMode,
                featuredCounts: getFeaturedTokenCountsByChain(),
                representedChainCount: new Set(publicTokens.map((token) => token.chainId)).size,
                supplementCount: supplements.length,
            },
        },
    }
}

function featuredTokensForChain<T extends {
    token: CatalogToken
    index: number
    poolLike: boolean
}>(entries: readonly T[], chainId: number) {
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

const CATALOG_QUERY_PARAMETERS = [
    'chainId',
    'search',
    'limit',
    'mode',
    'pageSize',
    'cursor',
] as const

export async function tokenCatalogRoutes(app: FastifyInstance) {
    app.get('/v1/token-catalog', {
        /*
         * The only route here without the guard its siblings share. Fastify's
         * parser returns an array for a repeated parameter, and the handler
         * calls string methods on these values unconditionally, so a repeated
         * parameter used to throw a TypeError and return 500.
         */
        schema: {
            querystring: {
                type: 'object',
                properties: Object.fromEntries(CATALOG_QUERY_PARAMETERS.map(
                    (name) => [name, { type: 'string', maxLength: 128 }],
                )),
            },
        },
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        // Rejected rather than stripped, matching every sibling catalog route.
        if (Object.keys(request.query as object).some((key) =>
            !CATALOG_QUERY_PARAMETERS.includes(key as never),
        )) {
            return reply.code(400).send({
                error: {
                    code: 'UNSUPPORTED_QUERY_PARAMETER',
                    message: 'Unsupported query parameter.',
                },
            })
        }
        const result = await getTokenCatalog(request.query as CatalogQuery)
        return reply.code(result.statusCode).send(result.body)
    })
}
