import fs from 'node:fs'

function replaceOnce(path, before, after) {
    const source = fs.readFileSync(path, 'utf8')
    if (!source.includes(before)) {
        throw new Error(`Expected patch target was not found in ${path}`)
    }
    fs.writeFileSync(path, source.replace(before, after))
}

replaceOnce(
    'src/features/tokens/model/tokenSelectorState.js',
    "import {\n    compareDecimalStrings,\n} from '../services/portfolio.js'",
    "import Fuse from 'fuse.js'\n\nimport {\n    compareDecimalStrings,\n} from '../services/portfolio.js'",
)

replaceOnce(
    'src/features/tokens/model/tokenSelectorState.js',
    `/** Returns whether a token matches a name, symbol, alias, or address query locally. */
export function tokenMatchesSearch(token, query, chainId = token?.chainId ?? 'all') {
    const interpreted = interpretTokenSearchQuery({
        chainId,
        query,
    })
    const normalizedQuery = interpreted.query
    if (!normalizedQuery) return true

    if (
        interpreted.chainQualified &&
        Number(token?.chainId) !== Number(interpreted.chainId)
    ) {
        return false
    }

    const searchAliases = Array.isArray(token?.searchAliases)
        ? token.searchAliases
        : []

    return [
        token?.name,
        token?.symbol,
        token?.address,
        token?.sourceName,
        token?.sourceSymbol,
        ...searchAliases,
    ].some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery))
}`,
    `const tokenFuseCache = new WeakMap()

function getTokenFuse(token) {
    if (!token || typeof token !== 'object') return null
    const cached = tokenFuseCache.get(token)
    if (cached) return cached

    const document = {
        name: String(token?.name ?? ''),
        symbol: String(token?.symbol ?? ''),
        sourceName: String(token?.sourceName ?? ''),
        sourceSymbol: String(token?.sourceSymbol ?? ''),
        aliases: Array.isArray(token?.searchAliases) ? token.searchAliases : [],
    }
    const fuse = new Fuse([document], {
        includeScore: true,
        ignoreLocation: true,
        threshold: 0.3,
        minMatchCharLength: 2,
        useTokenSearch: true,
        tokenMatch: 'all',
        keys: [
            { name: 'symbol', weight: 1 },
            { name: 'aliases', weight: 0.95 },
            { name: 'name', weight: 0.85 },
            { name: 'sourceSymbol', weight: 0.75 },
            { name: 'sourceName', weight: 0.65 },
        ],
    })
    tokenFuseCache.set(token, fuse)
    return fuse
}

/** Returns whether a token matches a name, symbol, alias, or address query locally. */
export function tokenMatchesSearch(token, query, chainId = token?.chainId ?? 'all') {
    const interpreted = interpretTokenSearchQuery({
        chainId,
        query,
    })
    const normalizedQuery = interpreted.query
    if (!normalizedQuery) return true

    if (
        interpreted.chainQualified &&
        Number(token?.chainId) !== Number(interpreted.chainId)
    ) {
        return false
    }

    if (/^0x[a-f0-9]{40}$/.test(normalizedQuery)) {
        return normalizeAddress(token?.address) === normalizedQuery
    }

    return Boolean(getTokenFuse(token)?.search(normalizedQuery, { limit: 1 }).length)
}`,
)

replaceOnce(
    'apps/api/src/modules/token-catalog.ts',
    "import type { FastifyInstance } from 'fastify'",
    "import Fuse from 'fuse.js'\nimport type { FastifyInstance } from 'fastify'",
)

replaceOnce(
    'apps/api/src/modules/token-catalog.ts',
    `type CatalogRankedEntry = {
    token: CatalogToken
    index: number
    category: number
    featuredRank: number | null
    poolLike: boolean
}`,
    `type CatalogRankedEntry = {
    token: CatalogToken
    index: number
    category: number
    fuzzyScore: number
    featuredRank: number | null
    poolLike: boolean
}`,
)

replaceOnce(
    'apps/api/src/modules/token-catalog.ts',
    `function compareRankedEntries(left: CatalogRankedEntry, right: CatalogRankedEntry) {
    return left.category - right.category ||
        Number(left.featuredRank ?? 9999) - Number(right.featuredRank ?? 9999) ||
        Number(left.poolLike) - Number(right.poolLike) ||
        left.index - right.index
}`,
    `function chainSearchAliases(chainId: number) {
    const chain = getTokenDiscoveryChain(chainId)
    if (!chain) return []
    return [
        chain.name,
        chain.native.name,
        chain.native.symbol,
        String(chain.chainId),
        ...Object.values(chain.providers).filter((value): value is string =>
            typeof value === 'string' && value.length > 0),
    ]
}

function fuzzySearchRankedEntries(
    entries: readonly { token: CatalogToken; index: number }[],
    query: string,
) {
    const documents = entries.map(({ token, index }) => {
        const override = getTokenCatalogOverride(token.chainId, token.address)
        return {
            token,
            index,
            displaySymbol: override?.displaySymbol ?? token.symbol,
            upstreamSymbol: token.symbol,
            displayName: override?.displayName ?? token.name,
            aliases: tokenAliases(token),
            chainAliases: chainSearchAliases(token.chainId),
        }
    })
    const fuse = new Fuse(documents, {
        includeScore: true,
        ignoreLocation: true,
        threshold: 0.32,
        minMatchCharLength: 2,
        useTokenSearch: true,
        tokenMatch: 'all',
        keys: [
            { name: 'displaySymbol', weight: 1 },
            { name: 'aliases', weight: 0.95 },
            { name: 'upstreamSymbol', weight: 0.85 },
            { name: 'displayName', weight: 0.8 },
            { name: 'chainAliases', weight: 0.2 },
        ],
    })

    return fuse.search(query, {
        limit: Math.max(MAX_SEARCH_RESULTS * 8, 120),
    }).map((result) => {
        const poolLike = isPoolVaultOrReceiptToken(result.item.token)
        return {
            token: result.item.token,
            index: result.item.index,
            category: poolLike ? 10 : 9,
            fuzzyScore: Number(result.score ?? 1),
            featuredRank: getTokenCatalogOverride(
                result.item.token.chainId,
                result.item.token.address,
            )?.featuredRank ?? null,
            poolLike,
        } satisfies CatalogRankedEntry
    })
}

function compareRankedEntries(left: CatalogRankedEntry, right: CatalogRankedEntry) {
    return left.category - right.category ||
        left.fuzzyScore - right.fuzzyScore ||
        Number(left.featuredRank ?? 9999) - Number(right.featuredRank ?? 9999) ||
        Number(left.poolLike) - Number(right.poolLike) ||
        left.index - right.index
}`,
)

replaceOnce(
    'apps/api/src/modules/token-catalog.ts',
    `    const ranked: CatalogRankedEntry[] = catalogTokens
        .map((token, index) => ({ token, index }))
        .filter(({ token }) => chainScope === 'all' || token.chainId === chainScope)
        .map((entry) => ({
            ...entry,
            category: tokenSearchCategory(entry.token, normalizedSearch),
            featuredRank: getTokenCatalogOverride(entry.token.chainId, entry.token.address)?.featuredRank ?? null,
            poolLike: isPoolVaultOrReceiptToken(entry.token),
        }))
        .filter(({ category }) => normalizedSearch ? category >= 0 : true)
        .sort(compareRankedEntries)`,
    `    const scopedEntries = catalogTokens
        .map((token, index) => ({ token, index }))
        .filter(({ token }) => chainScope === 'all' || token.chainId === chainScope)
    const deterministicRanked: CatalogRankedEntry[] = scopedEntries
        .map((entry) => ({
            ...entry,
            category: normalizedSearch ? tokenSearchCategory(entry.token, normalizedSearch) : 0,
            fuzzyScore: 0,
            featuredRank: getTokenCatalogOverride(entry.token.chainId, entry.token.address)?.featuredRank ?? null,
            poolLike: isPoolVaultOrReceiptToken(entry.token),
        }))
        .filter(({ category }) => normalizedSearch ? category >= 0 : true)

    let ranked = deterministicRanked
    const exactAddressSearch = /^0x[a-f0-9]{40}$/.test(normalizedSearch)
    if (normalizedSearch && !exactAddressSearch) {
        const selectedIds = new Set(deterministicRanked.map((entry) =>
            createTokenId(entry.token.chainId, entry.token.address)))
        const fuzzyRanked = fuzzySearchRankedEntries(scopedEntries, normalizedSearch)
            .filter((entry) => {
                const identity = createTokenId(entry.token.chainId, entry.token.address)
                if (selectedIds.has(identity)) return false
                selectedIds.add(identity)
                return true
            })
        ranked = [...deterministicRanked, ...fuzzyRanked]
    }
    ranked.sort(compareRankedEntries)`,
)

replaceOnce(
    'apps/api/src/modules/token-catalog.ts',
    `    const tokens = chainIds.flatMap((chainId) =>
        getFallbackTokensForChain(chainId).then((chainTokens) =>
            chainTokens.filter((token) => {
                if (!search) return true
                return [token.address, token.symbol, token.name].some((value) =>
                    String(value ?? '').toLowerCase().includes(search))
            }),
        ),
    )
    const resolvedTokens = (await Promise.all(tokens)).flat()
    const selected = resolvedTokens.slice(0, Math.min(limit, search ? MAX_SEARCH_RESULTS : limit))`,
    `    const tokens = chainIds.map((chainId) => getFallbackTokensForChain(chainId))
    const resolvedTokens = (await Promise.all(tokens)).flat()
    let searchedTokens = resolvedTokens
    if (search) {
        if (/^0x[a-f0-9]{40}$/.test(search)) {
            searchedTokens = resolvedTokens.filter((token) => token.address.toLowerCase() === search)
        } else {
            searchedTokens = new Fuse(resolvedTokens, {
                ignoreLocation: true,
                threshold: 0.32,
                minMatchCharLength: 2,
                useTokenSearch: true,
                tokenMatch: 'all',
                keys: [
                    { name: 'symbol', weight: 1 },
                    { name: 'name', weight: 0.85 },
                ],
            }).search(search, { limit: MAX_SEARCH_RESULTS }).map((result) => result.item)
        }
    }
    const selected = searchedTokens.slice(0, Math.min(limit, search ? MAX_SEARCH_RESULTS : limit))`,
)

replaceOnce(
    'src/features/tokens/model/tokenSearchQuery.js',
    "        normalizedName,\n        simplifiedName,\n        withoutChainSuffix,\n        String(chain.id),",
    "        normalizedName,\n        normalizedName.replace(/\\s+/g, ''),\n        simplifiedName,\n        withoutChainSuffix,\n        String(chain.id),",
)

replaceOnce(
    'src/features/tokens/model/tokenSearchQuery.js',
    "        Number(left.position === 'suffix') - Number(right.position === 'suffix'))",
    "        Number(right.position === 'suffix') - Number(left.position === 'suffix'))",
)

replaceOnce(
    'src/features/tokens/model/tokenSelectorState.search.test.js',
    "import { tokenMatchesSearch } from './tokenSelectorState.js'",
    "import { TOKEN_DISCOVERY_CHAINS } from '../../../web3/curatedEvmChains.js'\nimport { tokenMatchesSearch } from './tokenSelectorState.js'",
)

replaceOnce(
    'src/features/tokens/model/tokenSelectorState.search.test.js',
    `    it('uses the token chain as the safe fallback scope when a caller omits scope', () => {
        expect(tokenMatchesSearch(bnbMatic, 'matic')).toBe(true)
    })
})`,
    `    it('uses the token chain as the safe fallback scope when a caller omits scope', () => {
        expect(tokenMatchesSearch(bnbMatic, 'matic')).toBe(true)
    })

    it('recognizes every enabled network name without a per-network parser branch', () => {
        for (const chain of TOKEN_DISCOVERY_CHAINS) {
            const token = {
                chainId: chain.id,
                address: '0x2222222222222222222222222222222222222222',
                name: 'USD Coin',
                symbol: 'USDC',
            }
            expect(
                tokenMatchesSearch(token, \`usdc \${chain.name}\`, 'all'),
                \`Expected \${chain.name} to work as a network qualifier\`,
            ).toBe(true)
        }
    })

    it('uses fuzzy token and network matching for common typos and split tickers', () => {
        const arbitrumUsdc = {
            chainId: 42161,
            address: '0x3333333333333333333333333333333333333333',
            name: 'USD Coin',
            symbol: 'USDC',
        }
        expect(tokenMatchesSearch(arbitrumUsdc, 'usdcc arbitum', 'all')).toBe(true)
        expect(tokenMatchesSearch(arbitrumUsdc, 'usd c arbitrum', 'all')).toBe(true)
    })
})`,
)

replaceOnce(
    'apps/api/test/token-catalog-ranking.test.ts',
    `    it('keeps exact-address search ahead of canonical symbol ranking', async () => {`,
    `    it('finds canonical tokens through Fuse when the ticker contains a typo', async () => {
        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: '/v1/token-catalog?chainId=56&mode=all&search=USDTT&limit=20',
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        expect(response.json().tokens[0]).toMatchObject({
            address: bnbUsdt,
            symbol: 'USDT',
        })
    })

    it('keeps exact-address search ahead of canonical symbol ranking', async () => {`,
)

console.log('Fuse token-search source upgrade applied.')
