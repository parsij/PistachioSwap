import { resolvePchainedSelection } from './pchained.mjs'
import { canConnect, resolveSibling } from './utils.mjs'

const root = process.cwd()
const pchainedDir = resolveSibling(root, process.env.PCHAINED_LOCAL_DIR, ['../Pchained'])

const services = [
    { name: 'frontend', port: 5173 },
    { name: 'public-api', port: 3001 },
]

try {
    const { selected } = resolvePchainedSelection({
        pchainedDir,
        argv: process.argv.slice(2),
        requireConfigured: true,
    })
    services.push(...selected.map((chain) => ({ name: `pchained:${chain.name}`, port: chain.port })))
} catch (error) {
    console.error(`[local:status] ${error.message}`)
}

let unhealthy = false
for (const service of services) {
    const online = await canConnect(service.port)
    console.log(`${online ? 'online ' : 'offline'}  ${service.name.padEnd(28)} 127.0.0.1:${service.port}`)
    if (!online) unhealthy = true
}

process.exitCode = unhealthy ? 1 : 0
