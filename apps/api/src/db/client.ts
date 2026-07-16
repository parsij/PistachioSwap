import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import * as schema from './schema.js'

let pool: pg.Pool | null = null

export function getPool() {
    if (pool) return pool
    const connectionString = process.env.DATABASE_URL?.trim()
    if (!connectionString) throw new Error('DATABASE_URL is required for Gas Assist.')
    pool = new pg.Pool({ connectionString, max: 10 })
    return pool
}

export function getDatabase() {
    return drizzle(getPool(), { schema })
}

export async function checkDatabase() {
    const client = await getPool().connect()
    try {
        await client.query('select 1')
    } finally {
        client.release()
    }
}

export async function closeDatabase() {
    const current = pool
    pool = null
    await current?.end()
}
