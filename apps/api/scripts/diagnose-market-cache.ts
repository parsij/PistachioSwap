import { MARKET_CATALOG_SCHEMA_VERSION, createMarketCatalogService } from '../src/modules/market-tokens.js'
import { postgresMarketCatalogPersistence } from '../src/market-catalog/persistence.js'
import { ACTIVE_TOKEN_DISCOVERY_CHAINS } from '../src/token-discovery/registry.js'

const arguments_ = process.argv.slice(2)
const all = arguments_.includes('--all')
const chainArgumentIndex = arguments_.indexOf('--chain-id')
const requestedChainId = chainArgumentIndex >= 0
    ? Number(arguments_[chainArgumentIndex + 1])
    : null

if (!all && !Number.isSafeInteger(requestedChainId)) {
    throw new Error('Use --all or --chain-id <active-chain-id>.')
}

const targetChainIds = ACTIVE_TOKEN_DISCOVERY_CHAINS
    .map((chain) => chain.chainId)
    .filter((chainId) => all || chainId === requestedChainId)

if (targetChainIds.length === 0) {
    throw new Error('The requested chain is not active for token discovery.')
}

const service = createMarketCatalogService()
const hydration = await service.hydratePersistentCatalogs()
let persisted = []
try {
    persisted = await postgresMarketCatalogPersistence.loadAll()
} catch {
    console.log(JSON.stringify({
        schemaVersion: MARKET_CATALOG_SCHEMA_VERSION,
        databaseAvailable: false,
        hydration,
        chains: targetChainIds.map((chainId) => ({ chainId })),
    }, null, 2))
    process.exit(0)
}

const persistedByChain = new Map(persisted.map((row) => [row.chainId, row]))
const providers = ['dexpaprika', 'geckoterminal', 'coingecko', 'dexscreener'] as const

console.log(JSON.stringify({
    schemaVersion: MARKET_CATALOG_SCHEMA_VERSION,
    databaseAvailable: true,
    hydration,
    chains: targetChainIds.map((chainId) => {
        const row = persistedByChain.get(chainId)
        const memory = service.getCatalogCacheDiagnostic(chainId)
        return {
            chainId,
            persistedRankedCount: Array.isArray(row?.rankedTokens)
                ? row.rankedTokens.length
                : 0,
            persistedCommonCount: Array.isArray(row?.commonTokens)
                ? row.commonTokens.length
                : 0,
            memoryRankedCount: memory.memoryRankedCount,
            memoryCommonCount: memory.memoryCommonCount,
            lastAttemptedAt: row?.lastAttemptedAt?.toISOString() ?? null,
            lastSuccessfulAt: row?.lastSuccessAt?.toISOString() ?? null,
            nextScheduledRefresh: row?.nextRefreshAt?.toISOString() ?? null,
            schemaVersion: row?.schemaVersion ?? null,
            catalogSource: memory.source,
            providerBackoff: Object.fromEntries(providers.flatMap((provider) => {
                const backoff = service.getProviderBackoffForTest(chainId, provider)
                return backoff ? [[provider, {
                    code: backoff.code,
                    nextAttemptAt: new Date(backoff.nextAttemptAt).toISOString(),
                }]] : []
            })),
            contentHashSuffix: row?.contentHash?.slice(-12) ?? null,
        }
    }),
}, null, 2))
