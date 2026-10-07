import { crossChainProviderAudit } from '../src/cross-chain/provider-audit.js'
import { getApiConfig } from '../src/config.js'
import { CrossChainRegistry } from '../src/cross-chain/registry.js'
import type { CrossChainProviderName } from '../src/cross-chain/types.js'

const chainIds = [1, 10, 56, 100, 130, 137, 8453, 34443, 42161, 42220, 59144, 80094, 534352]
const audit = crossChainProviderAudit()
const registry = new CrossChainRegistry()
const reports = await Promise.all(audit.map(async provider => {
    const sourceChains = new Set<number>()
    let discovery = 'NOT_ATTEMPTED'
    if (provider.ready) {
        try {
            const capabilities = await registry.getCapabilities(provider.provider as CrossChainProviderName)
            for (const route of capabilities.routes) sourceChains.add(route.sourceChainId)
            discovery = capabilities.available ? 'CAPABLE' : 'UNAVAILABLE'
        } catch { discovery = 'DISCOVERY_FAILED' }
    }
    return { ...provider, discovery, sourceChains }
}))
const output = {
    providers: reports.map(({ sourceChains, ...provider }) => provider),
    feeBps: getApiConfig().fees.platformFeeBps,
    matrix: chainIds.flatMap(chainId => reports.map(report => ({
        chainId,
        provider: report.provider,
        normal: report.ready && report.sourceChains.has(chainId) ? 'CAPABLE' : 'UNAVAILABLE',
        fee: report.feeSupported ? 'CONFIGURED_TREASURY' : 'UNVERIFIED',
        reason: report.ready ? report.discovery : report.reason,
    }))),
    note: 'CAPABLE means provider discovery supports at least one destination. Exact token pair, quote validation and fee verification are still required. Gas Assist independently requires enabled source chain, token evidence, reviewed execution, provider-bound pins and funding preflight.',
}
process.stdout.write(JSON.stringify(output, null, 2) + '\n')
