from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Expected patch anchor not found in {path}")
    p.write_text(text.replace(old, new, 1))


registry = "apps/api/src/token-discovery/registry.ts"
replace_once(
    registry,
    "{ chainId: 137, name: 'Polygon PoS', active: true, native: { name: 'POL', symbol: 'POL', coinGeckoId: 'matic-network' }, wrappedNative:",
    "{ chainId: 137, name: 'Polygon PoS', active: true, native: { name: 'POL', symbol: 'POL', coinGeckoId: 'polygon-ecosystem-token', erc20Aliases: ['0x0000000000000000000000000000000000001010'] }, wrappedNative:",
)

logos = "apps/api/src/providers/token-logos.ts"
replace_once(
    logos,
    "    'matic-network': 'https://coin-images.coingecko.com/coins/images/4713/large/polygon.png?1698233745',\n",
    "    'matic-network': 'https://coin-images.coingecko.com/coins/images/4713/large/polygon.png?1698233745',\n    'polygon-ecosystem-token': 'https://coin-images.coingecko.com/coins/images/4713/large/polygon.png?1698233745',\n",
)

catalog = "apps/api/src/modules/token-catalog.ts"
replace_once(
    catalog,
    """    const publicTokens: PublicCatalogToken[] = tokens ?? selected.map(({ token, index }) =>
        publicToken(token, index, identityIndex, chainScope === 'all'))
    return {
""",
    """    let publicTokens: PublicCatalogToken[] = tokens ?? selected.map(({ token, index }) =>
        publicToken(token, index, identityIndex, chainScope === 'all'))

    // ShapeShift native CAIP IDs are not guaranteed to use slip44:60 on every
    // EVM chain. The active-chain registry is authoritative for native assets,
    // so a missing upstream native record must never make POL/ETH/etc.
    // undiscoverable in a chain-specific selector.
    if (chainScope !== 'all') {
        const chain = getTokenDiscoveryChain(chainScope)!
        const nativeTerms = [
            NATIVE_TOKEN_ADDRESS,
            chain.native.symbol,
            chain.native.name,
            chain.name,
            `native ${chain.native.symbol}`,
        ].map((value) => value.toLowerCase())
        const nativeMatches = normalizedSearch
            ? nativeTerms.some((value) =>
                  value === normalizedSearch || value.includes(normalizedSearch))
            : catalogMode === 'featured'
        const hasNative = publicTokens.some((token) =>
            token.address === NATIVE_TOKEN_ADDRESS)
        if (nativeMatches && !hasNative) {
            publicTokens = [
                publicRegistryNativeToken(chain, -1),
                ...publicTokens,
            ].slice(0, Math.min(
                requestedLimit,
                normalizedSearch ? MAX_SEARCH_RESULTS : requestedLimit,
            ))
        }
    }

    return {
""",
)

market = "apps/api/src/modules/market-tokens-base.ts"
replace_once(
    market,
    """import {
    getFallbackTokensForAllChains,
    getFallbackTokensForChain,
    loadFallbackTokenCatalog,
} from '../token-discovery/fallback-token-catalog.js'
""",
    """import {
    getFallbackTokensForAllChains,
    getFallbackTokensForChain,
    loadFallbackTokenCatalog,
} from '../token-discovery/fallback-token-catalog.js'
import {
    searchFallbackTokenAddressDirectory,
} from '../token-discovery/fallback-token-addresses.js'
""",
)

old_search = """    async function getTextSearch(chainId: number, query: string) {
        let candidates: TokenCandidate[] = []
        let markets = new Map<string, TokenMarket>()

        try {
            candidates = await resolved.searchCandidates(query, undefined, chainId)
        } catch {}
        if (candidates.length > 0) {
            try {
                markets = asMarketResult(
                    await resolved.fetchMarkets(
                        candidates.map((candidate) => candidate.address),
                        undefined,
                        chainId,
                    ),
                ).markets
            } catch {}
        } else {
            try {
                const fallbackMarkets = await resolved.searchMarkets(query, undefined, chainId)
                markets = new Map(
                    fallbackMarkets.map((market) => [market.address, market]),
                )
                candidates = fallbackMarkets.map(candidateFromMarket)
            } catch {}
        }

        if (candidates.length === 0) {
            return []
        }
        const tokens = await enrichSearchCandidates({
            chainId,
            candidates: candidates.slice(0, 20),
            markets,
            dependencies: resolved,
        })
        return rankBroaderSearch(tokens, query)
    }
"""
new_search = """    async function getTextSearch(chainId: number, query: string) {
        // Search providers independently and merge them with the reviewed local
        // fallback-address directory. A provider outage or incomplete Polygon
        // index must not turn a known token search into an empty result.
        const [candidateResult, marketSearchResult, fallbackResult] =
            await Promise.allSettled([
                resolved.searchCandidates(query, undefined, chainId),
                resolved.searchMarkets(query, undefined, chainId),
                searchFallbackTokenAddressDirectory(query),
            ])

        const providerCandidates = candidateResult.status === 'fulfilled'
            ? candidateResult.value
            : []
        const marketValues = marketSearchResult.status === 'fulfilled'
            ? marketSearchResult.value
            : []
        const localCandidates: TokenCandidate[] = fallbackResult.status === 'fulfilled'
            ? fallbackResult.value
                  .filter((entry) => entry.chainId === chainId)
                  .slice(0, 20)
                  .map((entry) => ({
                      address: entry.address,
                      name: entry.name,
                      symbol: entry.symbol,
                      decimals: null,
                      imageUrl: null,
                      coinGeckoId: null,
                      priceUSD: null,
                      imageSource: null,
                  }))
            : []
        const candidates = uniqueCandidates([
            ...providerCandidates,
            ...marketValues.map(candidateFromMarket),
            ...localCandidates,
        ]).slice(0, 20)
        if (candidates.length === 0) return []

        let markets = new Map(
            marketValues.map((market) => [market.address, market]),
        )
        try {
            const directMarkets = asMarketResult(
                await resolved.fetchMarkets(
                    candidates.map((candidate) => candidate.address),
                    undefined,
                    chainId,
                ),
            ).markets
            markets = new Map([...markets, ...directMarkets])
        } catch {
            // Search remains useful from local metadata + RPC/Alchemy metadata.
        }

        const tokens = await enrichSearchCandidates({
            chainId,
            candidates,
            markets,
            dependencies: resolved,
        })
        return rankBroaderSearch(tokens, query)
    }
"""
replace_once(market, old_search, new_search)

registry_test = "apps/api/test/token-discovery-registry.test.ts"
replace_once(
    registry_test,
    """    UNCHAINED_EVM_COINSTACKS_BY_CHAIN_ID,
    getTokenDiscoveryChain,
""",
    """    UNCHAINED_EVM_COINSTACKS_BY_CHAIN_ID,
    canonicalTokenAddress,
    getTokenDiscoveryChain,
""",
)
replace_once(
    registry_test,
    """        expect(getTokenDiscoveryChain(137)?.providers.coinGeckoNetwork)
            .toBe('polygon_pos')
""",
    """        expect(getTokenDiscoveryChain(137)?.providers.coinGeckoNetwork)
            .toBe('polygon_pos')
        expect(getTokenDiscoveryChain(137)?.native).toMatchObject({
            symbol: 'POL',
            coinGeckoId: 'polygon-ecosystem-token',
        })
        expect(canonicalTokenAddress(
            137,
            '0x0000000000000000000000000000000000001010',
        )).toBe(NATIVE_TOKEN_ADDRESS)
""",
)

ranking_test = "apps/api/test/token-catalog-ranking.test.ts"
replace_once(
    ranking_test,
    """    it('gives wrapped native tokens shared and chain-logo icon fallbacks', async () => {
""",
    """    it('keeps Polygon POL discoverable from the active-chain registry', async () => {
        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: '/v1/token-catalog?chainId=137&mode=all&search=POL&limit=20',
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        expect(response.json().tokens[0]).toMatchObject({
            chainId: 137,
            address: '0x0000000000000000000000000000000000000000',
            symbol: 'POL',
            isNative: true,
        })
    })

    it('gives wrapped native tokens shared and chain-logo icon fallbacks', async () => {
""",
)

for temporary in [
    Path('.github/workflows/fix-polygon-token-discovery.yml'),
    Path('.github/scripts/fix_polygon_token_discovery.py'),
]:
    if temporary.exists():
        temporary.unlink()
