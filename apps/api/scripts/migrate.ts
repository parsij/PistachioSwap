import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { getPool } from '../src/db/client.js'

const pool = getPool()
const lockClient = await pool.connect()
try {
    await lockClient.query(
        `SELECT pg_advisory_lock(hashtext('pistachio_migrations'))`,
    )
    await lockClient.query(`
      CREATE TABLE IF NOT EXISTS pistachio_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    const directory = path.resolve('drizzle')
    const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()

    for (const file of files) {
        const applied = await lockClient.query(
            'SELECT 1 FROM pistachio_migrations WHERE id = $1',
            [file],
        )
        if (applied.rowCount) continue
        const sql = await readFile(path.join(directory, file), 'utf8')
        await lockClient.query('BEGIN')
        try {
            await lockClient.query(sql)
            await lockClient.query('INSERT INTO pistachio_migrations (id) VALUES ($1)', [file])
            await lockClient.query('COMMIT')
            console.log(`Applied ${file}`)
        } catch (error) {
            await lockClient.query('ROLLBACK')
            throw error
        }
    }
} finally {
    await lockClient.query(
        `SELECT pg_advisory_unlock(hashtext('pistachio_migrations'))`,
    ).catch(() => undefined)
    lockClient.release()
    await pool.end()
}
