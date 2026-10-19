import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { HOSTED_ORIGIN, hostedApiProxy, readPublicFrontendEnvironment } from './hosted-frontend-config.mjs'

async function main() {
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node.js 24.')
    console.log('Loading public frontend settings from PistachioSwap. No .env file is needed.')
    const response = await fetch(`${HOSTED_ORIGIN}/pistachio-build-manifest.json`, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'cache-control': 'no-cache' },
        redirect: 'error',
    })
    if (!response.ok) throw new Error(`Public frontend settings returned HTTP ${response.status}.`)
    const environment = readPublicFrontendEnvironment(await response.json())
    for (const [key, value] of Object.entries(environment)) process.env[key] = value
    process.env.VITE_API_BASE_URL = '/api'
    process.env.VITE_PISTACHIO_HOSTED_FRONTEND = 'true'
    process.env.VITE_DEBUG_SPONSORSHIP_TRACE = 'false'
    process.env.VITE_VERSION = 'local'
    const { createServer } = await import('vite')
    const server = await createServer({
        root: resolve(fileURLToPath(new URL('..', import.meta.url))),
        mode: 'hosted',
        server: {
            host: 'localhost',
            port: 5173,
            strictPort: true,
            open: '/swap/',
            proxy: { '/api': hostedApiProxy() },
        },
    })
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, async () => {
            await server.close()
            process.exit(0)
        })
    }
    try {
        await server.listen()
    } catch (error) {
        await server.close()
        throw error
    }
    console.log('Local frontend: http://localhost:5173/swap/')
    console.log('Quotes and Gas Assist use PistachioSwap hosted services; their fees, screening, and availability still apply.')
    console.log('Wallet storage and passkeys belong to this local origin, separately from pistachioswap.com.')
}

main().catch((error) => {
    console.error(`[self-host] ${error.message}`)
    process.exitCode = 1
})
