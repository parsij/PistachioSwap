#!/usr/bin/env node

import { chmod, mkdir, readFile, rename, rm, watch, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_LEFT = '/opt/pistachio/env/api.env'
const DEFAULT_RIGHT = '/opt/gas-assist/env/api.env'
const LOCK_DIR = '/tmp/pistachio-shared-api-env-sync.lock'
const WATCH_DEBOUNCE_MS = 150
const LOCK_RETRY_MS = 50
const LOCK_TIMEOUT_MS = 5_000
const STALE_LOCK_MS = 30_000

// Synchronize only values intentionally consumed by both services. Copying every
// variable would expose service-specific database/provider credentials and would
// make legitimate differences such as PORT=3006 vs PORT=3002 conflict.
const DEFAULT_SHARED_KEYS = new Set([
    'GAS_ASSIST_INTERNAL_TOKEN',
    'COMPLIANCE_ENABLED',
    'COMPLIANCE_FAIL_CLOSED',
    'COMPLIANCE_TRUST_CLOUDFLARE_GEO',
    'COMPLIANCE_BLOCKED_COUNTRY_CODES',
    'COMPLIANCE_BLOCKED_REGION_CODES',
    'OFAC_SDN_URL',
    'OFAC_CONSOLIDATED_URL',
    'OFAC_REFRESH_INTERVAL_MS',
    'OFAC_MAX_LIST_AGE_MS',
    'TRM_SANCTIONS_ENABLED',
    'TRM_SANCTIONS_URL',
    'TRM_SANCTIONS_AUTHORIZATION',
])

function parseArgs(argv) {
    const options = { left: DEFAULT_LEFT, right: DEFAULT_RIGHT, watch: false, required: false }
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index]
        if (argument === '--watch') options.watch = true
        else if (argument === '--required') options.required = true
        else if (argument === '--left') options.left = argv[++index]
        else if (argument === '--right') options.right = argv[++index]
        else {
            console.error(`[env-sync] Unknown argument: ${argument}`)
            process.exit(64)
        }
    }
    if (!options.left || !options.right) {
        console.error('[env-sync] --left and --right require paths.')
        process.exit(64)
    }
    return options
}

async function readOptionalSharedKeys(file) {
    try {
        const text = await readFile(file, 'utf8')
        return text
            .split(/\r?\n/u)
            .map((line) => line.replace(/#.*/u, '').trim())
            .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(line))
    } catch (error) {
        if (error?.code === 'ENOENT') return []
        throw error
    }
}

async function sharedKeys(left, right) {
    const result = new Set(DEFAULT_SHARED_KEYS)
    for (const file of [
        path.join(path.dirname(left), 'shared-env-keys'),
        path.join(path.dirname(right), 'shared-env-keys'),
    ]) {
        for (const key of await readOptionalSharedKeys(file)) result.add(key)
    }
    return result
}

function parseSharedEnv(text, file, keys) {
    const values = new Map()
    const duplicateConflicts = new Set()
    for (const line of text.split(/\r?\n/u)) {
        const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line)
        if (!match) continue
        const [, key, rawValue] = match
        if (!keys.has(key)) continue
        if (values.has(key) && values.get(key) !== rawValue) duplicateConflicts.add(key)
        else if (!values.has(key)) values.set(key, rawValue)
    }
    if (duplicateConflicts.size > 0) {
        throw new Error(
            `${file} defines shared keys more than once with different values: ${[...duplicateConflicts].sort().join(', ')}`,
        )
    }
    return values
}

async function readEnvFile(file, required) {
    try {
        return await readFile(file, 'utf8')
    } catch (error) {
        if (!required && error?.code === 'ENOENT') return null
        throw new Error(`Cannot read required environment file ${file}: ${error.message}`)
    }
}

async function atomicAppend(file, original, additions) {
    if (additions.length === 0) return false
    const directory = path.dirname(file)
    const base = path.basename(file)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const prefix = original.length === 0 || original.endsWith('\n') ? '' : '\n'
    const block = [
        `${prefix}# Synced shared PistachioSwap / Gas Assist settings.`,
        ...additions.map(([key, rawValue]) => `${key}=${rawValue}`),
        '',
    ].join('\n')
    const temp = path.join(directory, `.${base}.sync-${process.pid}-${Date.now()}`)
    await writeFile(temp, `${original}${block}`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await chmod(temp, 0o600)
    await rename(temp, file)
    await chmod(file, 0o600)
    return true
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function acquireLock() {
    const deadline = Date.now() + LOCK_TIMEOUT_MS
    while (true) {
        try {
            await mkdir(LOCK_DIR, { mode: 0o700 })
            try {
                await writeFile(path.join(LOCK_DIR, 'created-at'), String(Date.now()), { mode: 0o600 })
                return
            } catch (error) {
                await rm(LOCK_DIR, { recursive: true, force: true }).catch(() => undefined)
                throw error
            }
        } catch (error) {
            if (error?.code !== 'EEXIST') throw error
            try {
                const stamp = Number(await readFile(path.join(LOCK_DIR, 'created-at'), 'utf8'))
                if (Number.isFinite(stamp) && Date.now() - stamp > STALE_LOCK_MS) {
                    await rm(LOCK_DIR, { recursive: true, force: true })
                    continue
                }
            } catch {
                // The other process may still be creating or releasing its lock.
            }
            if (Date.now() >= deadline) {
                throw new Error('Timed out waiting for the shared environment synchronization lock.')
            }
            await sleep(LOCK_RETRY_MS)
        }
    }
}

async function withLock(callback) {
    await acquireLock()
    try {
        return await callback()
    } finally {
        await rm(LOCK_DIR, { recursive: true, force: true }).catch(() => undefined)
    }
}

async function syncOnce(options) {
    return withLock(async () => {
        const keys = await sharedKeys(options.left, options.right)
        const [leftText, rightText] = await Promise.all([
            readEnvFile(options.left, options.required),
            readEnvFile(options.right, options.required),
        ])
        if (leftText === null || rightText === null) {
            console.log('[env-sync] Peer environment is not present; skipping outside required production mode.')
            return
        }

        const leftValues = parseSharedEnv(leftText, options.left, keys)
        const rightValues = parseSharedEnv(rightText, options.right, keys)
        const conflicts = []
        const copyToLeft = []
        const copyToRight = []

        for (const key of [...keys].sort()) {
            const leftHas = leftValues.has(key)
            const rightHas = rightValues.has(key)
            if (leftHas && rightHas) {
                if (leftValues.get(key) !== rightValues.get(key)) conflicts.push(key)
                continue
            }
            if (leftHas) copyToRight.push([key, leftValues.get(key)])
            if (rightHas) copyToLeft.push([key, rightValues.get(key)])
        }

        if (conflicts.length > 0) {
            console.error(`[env-sync] CONFLICT: shared keys differ: ${conflicts.join(', ')}`)
            console.error('[env-sync] Values are intentionally not logged. Make the listed keys identical before either service starts.')
            throw new Error('Shared API environment conflict.')
        }

        const leftChanged = await atomicAppend(options.left, leftText, copyToLeft)
        const rightChanged = await atomicAppend(options.right, rightText, copyToRight)
        if (leftChanged) console.log(`[env-sync] Copied missing shared keys into ${options.left}: ${copyToLeft.map(([key]) => key).join(', ')}`)
        if (rightChanged) console.log(`[env-sync] Copied missing shared keys into ${options.right}: ${copyToRight.map(([key]) => key).join(', ')}`)
        if (!leftChanged && !rightChanged) console.log('[env-sync] Shared API environment keys are consistent.')
    })
}

async function watchFiles(options) {
    await syncOnce(options)
    const directories = [...new Set([path.dirname(options.left), path.dirname(options.right)])]
    const watchedNames = new Set([
        path.basename(options.left),
        path.basename(options.right),
        'shared-env-keys',
    ])
    let timer = null
    let running = false
    let queued = false

    const run = async () => {
        if (running) {
            queued = true
            return
        }
        running = true
        try {
            await syncOnce(options)
        } catch (error) {
            console.error(`[env-sync] ${error.message}`)
            process.exit(78)
        } finally {
            running = false
        }
        if (queued) {
            queued = false
            await run()
        }
    }

    const watchers = directories.map((directory) => watch(directory))
    for (const watcher of watchers) {
        ;(async () => {
            for await (const event of watcher) {
                if (!event.filename || !watchedNames.has(String(event.filename))) continue
                if (timer) clearTimeout(timer)
                timer = setTimeout(() => void run(), WATCH_DEBOUNCE_MS)
            }
        })().catch((error) => {
            console.error(`[env-sync] Watcher failed: ${error.message}`)
            process.exit(78)
        })
    }

    console.log(`[env-sync] Watching ${options.left} and ${options.right} for shared-setting changes.`)
    const shutdown = () => {
        for (const watcher of watchers) watcher.close()
        process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    await new Promise(() => {})
}

const options = parseArgs(process.argv.slice(2))
try {
    if (options.watch) await watchFiles(options)
    else await syncOnce(options)
} catch (error) {
    console.error(`[env-sync] ${error.message}`)
    process.exit(78)
}
