import type pg from 'pg'

import { getPool } from '../db/client.js'

export type MarketCatalogLock = {
    release(): Promise<void>
}

export type MarketCatalogLockManager = {
    acquire(scope: string): Promise<MarketCatalogLock | null>
}

const localLocks = new Set<string>()

function databaseConfigured() {
    return Boolean(process.env.DATABASE_URL?.trim())
}

async function tryAcquireDatabaseLock(scope: string) {
    if (!databaseConfigured()) return null
    const client = await getPool().connect()
    let acquired = false
    try {
        const result = await client.query<{ locked: boolean }>(
            'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
            [scope],
        )
        acquired = result.rows[0]?.locked === true
        if (!acquired) {
            client.release()
            return null
        }
        return client
    } catch (error) {
        client.release()
        throw error
    }
}

export const marketCatalogLockManager: MarketCatalogLockManager = {
    async acquire(scope) {
        if (localLocks.has(scope)) return null
        localLocks.add(scope)
        let client: pg.PoolClient | null = null
        try {
            client = await tryAcquireDatabaseLock(scope)
            if (databaseConfigured() && client === null) {
                localLocks.delete(scope)
                return null
            }
            return {
                async release() {
                    try {
                        if (client) {
                            await client.query('SELECT pg_advisory_unlock(hashtext($1))', [scope])
                        }
                    } finally {
                        client?.release()
                        localLocks.delete(scope)
                    }
                },
            }
        } catch (error) {
            localLocks.delete(scope)
            throw error
        }
    },
}

export function clearMarketCatalogLocksForTest() {
    localLocks.clear()
}
