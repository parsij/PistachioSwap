#!/usr/bin/env node

import { execFile } from 'node:child_process'
import {
    appendFile,
    chmod,
    mkdir,
    readFile,
    rename,
    rm,
    watch,
    writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DEFAULT_LEFT = '/opt/pistachio/env/api.env'
const DEFAULT_RIGHT = '/opt/gas-assist/env/api.env'
const DEFAULT_LOG_FILE = process.env.SHARED_ENV_SYNC_LOG?.trim()
    || '/opt/pistachio/.runtime/shared-env-sync.log'
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
    const options = {
        left: DEFAULT_LEFT,
        right: DEFAULT_RIGHT,
        watch: false,
        required: false,
        source: null,
        restartServices: false,
        logFile: DEFAULT_LOG_FILE,
    }
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index]
        if (argument === '--watch') options.watch = true
        else if (argument === '--required') options.required = true
        else if (argument === '--restart-services') options.restartServices = true
        else if (argument === '--left') options.left = argv[++index]
        else if (argument === '--right') options.right = argv[++index]
        else if (argument === '--log-file') options.logFile = argv[++index]
        else if (argument === '--source') options.source = argv[++index]
        else {
            console.error(`[env-sync] Unknown argument: ${argument}`)
            process.exit(64)
        }
    }
    if (!options.left || !options.right || !options.logFile) {
        console.error('[env-sync] --left, --right, and --log-file require paths.')
        process.exit(64)
    }
    if (options.source && !['left', 'right'].includes(options.source)) {
        console.error('[env-sync] --source must be left or right.')
        process.exit(64)
    }
    if (options.watch && options.source) {
        console.error('[env-sync] --source is only valid for one-shot synchronization.')
        process.exit(64)
    }
    return options
}

async function writeLog(options, message, { stderr = false } = {}) {
    const line = `[${new Date().toISOString()}] ${message}`
    const directory = path.dirname(options.logFile)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await appendFile(options.logFile, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
    await chmod(options.logFile, 0o600)
    if (stderr) console.error(message)
    else console.log(message)
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

async function atomicRewriteSharedValues(file, original, desiredValues, keys) {
    if (desiredValues.size === 0) return []

    const seen = new Set()
    const changedKeys = new Set()
    const lines = original.split(/\r?\n/u)
    const output = lines.map((line) => {
        const match = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*?)=(.*)$/u.exec(line)
        if (!match) return line
        const [, prefix, key, rawValue] = match
        if (!keys.has(key) || !desiredValues.has(key)) return line
        seen.add(key)
        const desired = desiredValues.get(key)
        if (rawValue !== desired) changedKeys.add(key)
        return `${prefix}${key}=${desired}`
    })

    const additions = []
    for (const [key, rawValue] of desiredValues) {
        if (seen.has(key)) continue
        additions.push([key, rawValue])
        changedKeys.add(key)
    }

    if (additions.length > 0) {
        if (output.length > 0 && output.at(-1) !== '') output.push('')
        output.push('# Synced shared PistachioSwap / Gas Assist settings.')
        for (const [key, rawValue] of additions) output.push(`${key}=${rawValue}`)
        output.push('')
    }

    if (changedKeys.size === 0) return []

    const directory = path.dirname(file)
    const base = path.basename(file)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temp = path.join(directory, `.${base}.sync-${process.pid}-${Date.now()}`)
    await writeFile(temp, output.join('\n'), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await chmod(temp, 0o600)
    await rename(temp, file)
    await chmod(file, 0o600)
    return [...changedKeys].sort()
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

function unionChanged(...groups) {
    return [...new Set(groups.flat())].sort()
}

async function syncFromSource(options, keys, leftText, rightText, sourcePath) {
    const sourceIsLeft = sourcePath === options.left
    const sourceText = sourceIsLeft ? leftText : rightText
    const peerText = sourceIsLeft ? rightText : leftText
    const peerPath = sourceIsLeft ? options.right : options.left

    const sourceValues = parseSharedEnv(sourceText, sourcePath, keys)
    const peerValues = parseSharedEnv(peerText, peerPath, keys)

    // A watched edit is authoritative for every shared key still present in the
    // edited file. Missing shared keys are restored from the peer so an accidental
    // deletion does not silently erase a required production setting.
    const peerChanged = await atomicRewriteSharedValues(peerPath, peerText, sourceValues, keys)

    const missingFromSource = new Map()
    for (const [key, rawValue] of peerValues) {
        if (!sourceValues.has(key)) missingFromSource.set(key, rawValue)
    }
    const sourceChanged = await atomicRewriteSharedValues(sourcePath, sourceText, missingFromSource, keys)

    const changed = unionChanged(peerChanged, sourceChanged)
    if (peerChanged.length > 0) {
        await writeLog(
            options,
            `[env-sync] Propagated shared keys from ${sourcePath} to ${peerPath}: ${peerChanged.join(', ')}`,
        )
    }
    if (sourceChanged.length > 0) {
        await writeLog(
            options,
            `[env-sync] Restored missing shared keys in ${sourcePath} from ${peerPath}: ${sourceChanged.join(', ')}`,
        )
    }
    if (changed.length === 0) {
        await writeLog(options, `[env-sync] Watched edit in ${sourcePath} did not change shared settings.`)
    }
    return changed
}

async function syncConservatively(options, keys, leftText, rightText) {
    const leftValues = parseSharedEnv(leftText, options.left, keys)
    const rightValues = parseSharedEnv(rightText, options.right, keys)
    const conflicts = []
    const copyToLeft = new Map()
    const copyToRight = new Map()

    for (const key of [...keys].sort()) {
        const leftHas = leftValues.has(key)
        const rightHas = rightValues.has(key)
        if (leftHas && rightHas) {
            if (leftValues.get(key) !== rightValues.get(key)) conflicts.push(key)
            continue
        }
        if (leftHas) copyToRight.set(key, leftValues.get(key))
        if (rightHas) copyToLeft.set(key, rightValues.get(key))
    }

    if (conflicts.length > 0) {
        await writeLog(
            options,
            `[env-sync] CONFLICT: shared keys differ: ${conflicts.join(', ')}`,
            { stderr: true },
        )
        await writeLog(
            options,
            '[env-sync] Values are intentionally not logged. Make the listed keys identical before either service starts.',
            { stderr: true },
        )
        throw new Error('Shared API environment conflict.')
    }

    const leftChanged = await atomicRewriteSharedValues(options.left, leftText, copyToLeft, keys)
    const rightChanged = await atomicRewriteSharedValues(options.right, rightText, copyToRight, keys)
    const changed = unionChanged(leftChanged, rightChanged)

    if (leftChanged.length > 0) {
        await writeLog(options, `[env-sync] Copied missing shared keys into ${options.left}: ${leftChanged.join(', ')}`)
    }
    if (rightChanged.length > 0) {
        await writeLog(options, `[env-sync] Copied missing shared keys into ${options.right}: ${rightChanged.join(', ')}`)
    }
    if (changed.length === 0) {
        await writeLog(options, '[env-sync] Shared API environment keys are consistent.')
    }
    return changed
}

async function syncOnce(options, sourcePath = null) {
    return withLock(async () => {
        const keys = await sharedKeys(options.left, options.right)
        const [leftText, rightText] = await Promise.all([
            readEnvFile(options.left, options.required),
            readEnvFile(options.right, options.required),
        ])
        if (leftText === null || rightText === null) {
            await writeLog(options, '[env-sync] Peer environment is not present; skipping outside required production mode.')
            return []
        }

        if (sourcePath) {
            if (sourcePath !== options.left && sourcePath !== options.right) {
                throw new Error(`Watched source is not a configured environment file: ${sourcePath}`)
            }
            return syncFromSource(options, keys, leftText, rightText, sourcePath)
        }
        return syncConservatively(options, keys, leftText, rightText)
    })
}

async function restartGasAssist(options, changedKeys) {
    if (!options.restartServices || changedKeys.length === 0) return
    await writeLog(
        options,
        `[env-sync] Reloading gas-assist after shared settings changed: ${changedKeys.join(', ')}`,
    )
    try {
        await execFileAsync('pm2', ['restart', 'gas-assist', '--update-env'], {
            cwd: process.env.HOME || '/',
            env: process.env,
            timeout: 60_000,
        })
    } catch {
        await writeLog(
            options,
            '[env-sync] Failed to reload gas-assist after a shared environment change.',
            { stderr: true },
        )
        throw new Error('Gas Assist reload failed after shared environment synchronization.')
    }
    await writeLog(options, '[env-sync] gas-assist reloaded successfully.')
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
    let pendingSource = null

    const run = async () => {
        if (running) {
            queued = true
            return
        }
        running = true
        const source = pendingSource
        pendingSource = null
        try {
            const changedKeys = await syncOnce(options, source)
            if (changedKeys.length > 0 && options.restartServices) {
                await restartGasAssist(options, changedKeys)
                await writeLog(
                    options,
                    '[env-sync] Requesting PistachioSwap API reload so the new shared environment is active.',
                )
                // The startup wrapper waits for this watcher. Exiting causes the
                // wrapper to stop the API, and PM2's autorestart starts both again
                // with the freshly synchronized environment.
                process.exit(75)
            }
        } catch (error) {
            await writeLog(options, `[env-sync] ${error.message}`, { stderr: true }).catch(() => undefined)
            process.exit(78)
        } finally {
            running = false
        }
        if (queued) {
            queued = false
            await run()
        }
    }

    const watchers = directories.map((directory) => ({
        directory,
        watcher: watch(directory),
    }))
    for (const { directory, watcher } of watchers) {
        ;(async () => {
            for await (const event of watcher) {
                if (!event.filename || !watchedNames.has(String(event.filename))) continue
                const candidate = path.join(directory, String(event.filename))
                if (candidate === options.left || candidate === options.right) pendingSource = candidate
                else pendingSource = null
                if (timer) clearTimeout(timer)
                timer = setTimeout(() => void run(), WATCH_DEBOUNCE_MS)
            }
        })().catch(async (error) => {
            await writeLog(options, `[env-sync] Watcher failed: ${error.message}`, { stderr: true }).catch(() => undefined)
            process.exit(78)
        })
    }

    await writeLog(
        options,
        `[env-sync] Watching ${options.left} and ${options.right} for shared-setting changes. Separate log: ${options.logFile}`,
    )
    const shutdown = () => {
        for (const { watcher } of watchers) watcher.close()
        process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    await new Promise(() => {})
}

const options = parseArgs(process.argv.slice(2))
try {
    if (options.watch) {
        await watchFiles(options)
    } else {
        const sourcePath = options.source === 'left'
            ? options.left
            : options.source === 'right'
                ? options.right
                : null
        const changedKeys = await syncOnce(options, sourcePath)
        await restartGasAssist(options, changedKeys)
    }
} catch (error) {
    await writeLog(options, `[env-sync] ${error.message}`, { stderr: true }).catch(() => {
        console.error(`[env-sync] ${error.message}`)
    })
    process.exit(78)
}
