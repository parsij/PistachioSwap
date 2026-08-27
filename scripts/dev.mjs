import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { startPchained, stopPchainedSessions } from './local/pchained.mjs'
import {
    canConnect,
    readDotEnv,
    requireCommand,
    resolveSibling,
    run,
    spawnManaged,
    verifyRepository,
} from './local/utils.mjs'

const root = process.cwd()
const argv = process.argv.slice(2)
const localMode = argv.includes('--local')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const children = new Map()
let pchainedSessions = []
let shuttingDown = false

function validateNode() {
    const major = Number(process.versions.node.split('.')[0])
    if (major !== 24) {
        throw new Error(`PistachioSwap requires Node.js 24 for development. Current: ${process.version}`)
    }
    requireCommand('pnpm')
}

function start(name, command, args, options = {}) {
    const child = spawnManaged(command, args, {
        cwd: options.cwd ?? root,
        env: options.env ?? process.env,
        stdio: 'inherit',
    })
    children.set(name, child)

    child.once('error', (error) => {
        console.error(`[dev:${name}] failed to start: ${error.message}`)
        void shutdown(1)
    })
    child.once('exit', (code, signal) => {
        children.delete(name)
        if (shuttingDown) return
        const reason = signal ? `signal ${signal}` : `status ${code ?? 'unknown'}`
        console.error(`[dev:${name}] exited unexpectedly with ${reason}`)
        void shutdown(code || 1)
    })
    return child
}

function terminate(child, signal) {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill(signal)
}

async function shutdown(exitCode = 0) {
    if (shuttingDown) return
    shuttingDown = true

    for (const child of children.values()) terminate(child, 'SIGTERM')
    stopPchainedSessions(pchainedSessions)
    pchainedSessions = []

    const forceTimer = setTimeout(() => {
        for (const child of children.values()) terminate(child, 'SIGKILL')
    }, 5_000)
    forceTimer.unref()

    const deadline = Date.now() + 6_000
    while (children.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    process.exit(exitCode)
}

async function assertPortFree(port, label) {
    if (await canConnect(port)) {
        throw new Error(`${label} cannot start because 127.0.0.1:${port} is already in use.`)
    }
}

async function startDefault() {
    await assertPortFree(3001, 'Public API')
    await assertPortFree(5173, 'Vite')
    console.log('Starting PistachioSwap frontend and public API...')
    start('api', pnpm, ['run', 'dev:api'])
    start('web', pnpm, ['run', 'dev:web'])
}

async function startLocal() {
    requireCommand('git')
    requireCommand('docker', 'Install Docker with the Compose plugin')
    run('docker', ['compose', 'version'], { stdio: 'ignore' })

    const pchainedDir = resolveSibling(
        root,
        process.env.PCHAINED_LOCAL_DIR,
        ['../Pchained'],
    )

    verifyRepository(pchainedDir, 'parsij/Pchained')

    const publicEnvPath = path.join(root, 'apps', 'api', '.env')
    if (!existsSync(publicEnvPath)) throw new Error(`Missing public API environment: ${publicEnvPath}`)
    const publicEnv = readDotEnv(publicEnvPath)

    await assertPortFree(3001, 'Public API')
    await assertPortFree(5173, 'Vite')

    const pchained = await startPchained({ root, pchainedDir, argv })
    pchainedSessions = pchained.sessions

    if (publicEnv.DATABASE_URL?.trim()) {
        console.log('[local] applying pending public API migrations')
        run(pnpm, ['--filter', '@pistachio/api', 'db:migrate'], { cwd: root })
    }

    const apiEnv = {
        ...process.env,
        UNCHAINED_ENABLED: 'true',
        UNCHAINED_HTTP_URLS_JSON: JSON.stringify(pchained.endpoints),
        HOST: '127.0.0.1',
        PORT: '3001',
    }
    console.log(
        `[local] starting full stack with ${pchained.selected.length} configured Pchained coinstack(s): ` +
        pchained.selected.map((chain) => chain.name).join(', '),
    )
    start('api', pnpm, ['run', 'dev:api'], { env: apiEnv })
    start('web', pnpm, ['run', 'dev:web'])
}

process.once('SIGINT', () => void shutdown(130))
process.once('SIGTERM', () => void shutdown(143))

try {
    validateNode()
    if (localMode) await startLocal()
    else await startDefault()
} catch (error) {
    console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`)
    await shutdown(1)
}
