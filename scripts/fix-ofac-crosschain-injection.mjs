import { readFile, writeFile } from 'node:fs/promises'

const path = 'apps/api/src/modules/cross-chain.ts'
let source = await readFile(path, 'utf8')

const signature = `export function createCrossChainRoutes(\n    service = new CrossChainRouteService(),\n    auth: CrossChainAuthService = getCrossChainAuthService(),\n): FastifyPluginAsync {`
const injected = `export function createCrossChainRoutes(\n    service = new CrossChainRouteService(),\n    auth: CrossChainAuthService = getCrossChainAuthService(),\n    compliance: ReturnType<typeof getComplianceService> | null = null,\n): FastifyPluginAsync {`
if (!source.includes(signature)) throw new Error('cross-chain route signature not found')
source = source.replace(signature, injected)

const enforcementCount = source.split('await getComplianceService().enforce').length - 1
if (enforcementCount < 1) throw new Error('cross-chain compliance enforcement not found')
source = source.replaceAll('await getComplianceService().enforce', 'await compliance?.enforce')

const exportLine = 'export const crossChainRoutes = createCrossChainRoutes()'
if (!source.includes(exportLine)) throw new Error('cross-chain production export not found')
source = source.replace(
  exportLine,
  'export const crossChainRoutes = createCrossChainRoutes(undefined, undefined, getComplianceService())',
)

await writeFile(path, source)
console.log(`Injected compliance dependency at ${enforcementCount} cross-chain enforcement points.`)
