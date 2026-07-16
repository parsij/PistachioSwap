import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { getPool } from '../src/db/client.js'

const pool = getPool()
await pool.query(`
  CREATE TABLE IF NOT EXISTS pistachio_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`)

const directory = path.resolve('drizzle')
const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()

for (const file of files) {
    const applied = await pool.query(
        'SELECT 1 FROM pistachio_migrations WHERE id = $1',
        [file],
    )
    if (applied.rowCount) continue
    const sql = await readFile(path.join(directory, file), 'utf8')
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO pistachio_migrations (id) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log(`Applied ${file}`)
    } catch (error) {
        await client.query('ROLLBACK')
        throw error
    } finally {
        client.release()
    }
}
await pool.end()
