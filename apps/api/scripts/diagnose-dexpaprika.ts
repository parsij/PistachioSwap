import { performance } from 'node:perf_hooks'

import { getApiConfig } from '../src/config.js'
import { fetchDexPaprikaNetworks } from '../src/providers/dexpaprika/client.js'
import { fetchDexPaprikaMarketTokens } from '../src/providers/dexpaprika/market-tokens.js'
import { DEXPAPRIKA_NETWORK_BY_CHAIN_ID } from '../src/providers/dexpaprika/networks.js'

const args = process.argv.slice(2)
const chainIndex = args.indexOf('--chain-id')
const requested = chainIndex >= 0 ? Number(args[chainIndex + 1]) : null
if (!args.includes('--all') && !Number.isInteger(requested)) {
    throw new Error('Use --all or --chain-id <id>.')
}

const payload = await fetchDexPaprikaNetworks()
const networkIds = new Set((Array.isArray(payload) ? payload : []).flatMap((row) =>
    typeof row === 'object' && row !== null && 'id' in row && typeof row.id === 'string'
        ? [row.id]
        : [],
))
const chainIds = requested === null
    ? Object.keys(DEXPAPRIKA_NETWORK_BY_CHAIN_ID).map(Number)
    : [requested]
const config = getApiConfig().dexPaprika

for (const chainId of chainIds) {
    const configuredNetworkId = DEXPAPRIKA_NETWORK_BY_CHAIN_ID[chainId] ?? null
    const providerNetworkExists = configuredNetworkId !== null && networkIds.has(configuredNetworkId)
    const started = performance.now()
    let resultCount = 0
    let excludedCount = 0
    let httpStatus: number | null = null
    let rateLimited = false
    if (providerNetworkExists) {
        try {
            const result = await fetchDexPaprikaMarketTokens({
                chainId, limit: config.perChainLimit,
                liquidityMinimumUsd: config.minimumLiquidityUsd,
                transactionMinimum24h: config.minimumTransactions24h,
            })
            resultCount = result.tokens.length
            excludedCount = result.malformedCount
            httpStatus = 200
        } catch (error) {
            const candidate = error as { upstreamStatus?: number }
            httpStatus = candidate.upstreamStatus ?? null
            rateLimited = httpStatus === 429
        }
    }
    console.log(JSON.stringify({
        chainId, configuredNetworkId, providerNetworkExists,
        attempted: providerNetworkExists, httpStatus, resultCount,
        eligibleCount: resultCount, excludedCount,
        durationMs: Math.round(performance.now() - started), rateLimited,
    }))
}
