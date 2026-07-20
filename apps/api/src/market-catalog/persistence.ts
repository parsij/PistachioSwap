import { getDatabase } from '../db/client.js'
import { marketTokenCatalogCache } from '../db/schema.js'

export type PersistedMarketCatalog = {
    chainId: number
    schemaVersion: number
    rankedTokens: unknown[]
    commonTokens: unknown[]
    providerStatus: unknown
    exclusionCounts: unknown
    partial: boolean
    generatedAt: Date | null
    lastAttemptedAt: Date | null
    lastSuccessAt: Date | null
    nextRefreshAt: Date | null
    contentHash: string | null
    updatedAt: Date
}

export type PersistedCatalogWrite = Omit<
    PersistedMarketCatalog,
    'lastAttemptedAt' | 'updatedAt'
> & {
    lastAttemptedAt: Date
}

export type MarketCatalogPersistence = {
    loadAll(): Promise<PersistedMarketCatalog[]>
    saveUsefulCatalog(catalog: PersistedCatalogWrite): Promise<void>
    recordAttempt(input: {
        chainId: number
        schemaVersion: number
        providerStatus?: unknown
        lastAttemptedAt: Date
        nextRefreshAt: Date
    }): Promise<void>
}

function databaseConfigured() {
    const runningUnderTests = process.env.NODE_ENV === 'test' ||
        process.env.VITEST === 'true' ||
        process.argv.some((argument) => argument.includes('vitest'))
    if (runningUnderTests &&
        process.env.MARKET_CATALOG_PERSISTENCE_TEST_ENABLED !== 'true') {
        return false
    }
    return Boolean(process.env.DATABASE_URL?.trim())
}

export function createPostgresMarketCatalogPersistence(): MarketCatalogPersistence {
    return {
        async loadAll() {
            if (!databaseConfigured()) return []
            const rows = await getDatabase().select().from(marketTokenCatalogCache)
            return rows.map((row) => ({
                ...row,
                rankedTokens: Array.isArray(row.rankedTokens)
                    ? row.rankedTokens
                    : [],
                commonTokens: Array.isArray(row.commonTokens)
                    ? row.commonTokens
                    : [],
            }))
        },

        async saveUsefulCatalog(catalog) {
            if (!databaseConfigured()) return
            const values = {
                ...catalog,
                updatedAt: new Date(),
            }
            await getDatabase()
                .insert(marketTokenCatalogCache)
                .values(values)
                .onConflictDoUpdate({
                    target: marketTokenCatalogCache.chainId,
                    set: values,
                })
        },

        async recordAttempt({
            chainId,
            schemaVersion,
            providerStatus,
            lastAttemptedAt,
            nextRefreshAt,
        }) {
            if (!databaseConfigured()) return
            const attemptValues = {
                ...(providerStatus === undefined ? {} : { providerStatus }),
                lastAttemptedAt,
                nextRefreshAt,
                updatedAt: new Date(),
            }
            await getDatabase()
                .insert(marketTokenCatalogCache)
                .values({
                    chainId,
                    schemaVersion,
                    rankedTokens: [],
                    commonTokens: [],
                    providerStatus: providerStatus ?? null,
                    exclusionCounts: {},
                    partial: true,
                    generatedAt: null,
                    lastAttemptedAt,
                    lastSuccessAt: null,
                    nextRefreshAt,
                    contentHash: null,
                    updatedAt: attemptValues.updatedAt,
                })
                .onConflictDoUpdate({
                    target: marketTokenCatalogCache.chainId,
                    set: attemptValues,
                })
        },
    }
}

export const postgresMarketCatalogPersistence =
    createPostgresMarketCatalogPersistence()
