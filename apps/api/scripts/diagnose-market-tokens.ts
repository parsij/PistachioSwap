import { getApiConfig } from '../src/config.js'
import { ProviderError } from '../src/lib/errors.js'
import { getTokenMetadataBatch } from '../src/providers/alchemy/token-metadata.js'
import { getCoinGeckoTokensBatch } from '../src/providers/coingecko/token-data.js'
import { fetchTokenMarkets } from '../src/providers/dexscreener/token-markets.js'
import { discoverTopPoolTokens } from '../src/providers/geckoterminal/top-pools.js'
import { getTokenDecimalsBatch } from '../src/providers/token-decimals.js'
import { getServerRpcUrl } from '../src/token-discovery/context.js'
import {
    ACTIVE_TOKEN_DISCOVERY_CHAINS,
    getTokenDiscoveryChain,
} from '../src/token-discovery/registry.js'

type DiagnosticRecord = {
    chainId: number
    chainName: string
    provider: string
    configured: boolean
    attempted: boolean
    outcome: 'success' | 'unavailable' | 'unsupported'
    safeCode: string | null
    candidateCount: number
    marketCount: number
    durationMs: number
}

function argument(name: string) {
    const index = process.argv.indexOf(name)
    return index >= 0 ? process.argv[index + 1] : undefined
}

function safeCode(error: unknown) {
    return error instanceof ProviderError
        ? error.code
        : 'PROVIDER_UNAVAILABLE'
}

async function attempt(
    base: Omit<DiagnosticRecord, 'attempted' | 'outcome' | 'safeCode' | 'candidateCount' | 'marketCount' | 'durationMs'>,
    run: (() => Promise<{ candidateCount?: number; marketCount?: number }>) | null,
): Promise<DiagnosticRecord> {
    const startedAt = Date.now()
    if (!base.configured || !run) {
        return {
            ...base,
            attempted: false,
            outcome: 'unsupported',
            safeCode: 'PROVIDER_UNSUPPORTED',
            candidateCount: 0,
            marketCount: 0,
            durationMs: 0,
        }
    }
    try {
        const result = await run()
        return {
            ...base,
            attempted: true,
            outcome: 'success',
            safeCode: null,
            candidateCount: result.candidateCount ?? 0,
            marketCount: result.marketCount ?? 0,
            durationMs: Date.now() - startedAt,
        }
    } catch (error) {
        return {
            ...base,
            attempted: true,
            outcome: 'unavailable',
            safeCode: safeCode(error),
            candidateCount: 0,
            marketCount: 0,
            durationMs: Date.now() - startedAt,
        }
    }
}

async function main() {
    const config = getApiConfig()
    const rawChainId = argument('--chain-id')
    const all = process.argv.includes('--all')
    const chainId = rawChainId === undefined ? config.chainId : Number(rawChainId)
    const chains = all
        ? ACTIVE_TOKEN_DISCOVERY_CHAINS
        : [getTokenDiscoveryChain(chainId)].filter(
              (chain): chain is NonNullable<typeof chain> => Boolean(chain?.active),
          )
    if (chains.length === 0) {
        console.error('A valid active --chain-id or --all is required.')
        process.exitCode = 1
        return
    }

    const results: DiagnosticRecord[] = []
    for (const chain of chains) {
        const base = { chainId: chain.chainId, chainName: chain.name }
        results.push(await attempt({
            ...base,
            provider: 'geckoterminal',
            configured: chain.capabilities.geckoTerminal,
        }, chain.capabilities.geckoTerminal
            ? async () => {
                  const result = await discoverTopPoolTokens({
                      chainId: chain.chainId,
                      minimumCandidates: 10,
                  })
                  return { candidateCount: result.candidates.length }
              }
            : null))
        results.push(await attempt({
            ...base,
            provider: 'coingecko',
            configured: chain.capabilities.coinGeckoOnchain &&
                Boolean(config.coinGecko.apiKey),
        }, chain.capabilities.coinGeckoOnchain && config.coinGecko.apiKey
            ? async () => {
                  const result = await getCoinGeckoTokensBatch(
                      [chain.wrappedNative.address],
                      undefined,
                      chain.chainId,
                  )
                  return { candidateCount: result.tokens.size }
              }
            : null))
        results.push(await attempt({
            ...base,
            provider: 'dexscreener',
            configured: chain.capabilities.dexScreener,
        }, chain.capabilities.dexScreener
            ? async () => {
                  const result = await fetchTokenMarkets(
                      [chain.wrappedNative.address],
                      undefined,
                      chain.chainId,
                  )
                  return { marketCount: result.markets.size }
              }
            : null))
        results.push(await attempt({
            ...base,
            provider: 'alchemy-metadata',
            configured: chain.capabilities.alchemy && Boolean(config.alchemy.apiKey),
        }, chain.capabilities.alchemy && config.alchemy.apiKey
            ? async () => {
                  const result = await getTokenMetadataBatch({
                      chainId: chain.chainId,
                      addresses: [chain.wrappedNative.address],
                  })
                  return {
                      candidateCount: [...result.values()].filter(Boolean).length,
                  }
              }
            : null))
        const rpcConfigured = chain.capabilities.rpcFallback &&
            Boolean(getServerRpcUrl(chain.chainId))
        results.push(await attempt({
            ...base,
            provider: 'rpc-metadata',
            configured: rpcConfigured,
        }, rpcConfigured
            ? async () => {
                  const result = await getTokenDecimalsBatch({
                      chainId: chain.chainId,
                      addresses: [chain.wrappedNative.address],
                  })
                  return {
                      candidateCount: [...result.values()].filter(
                          (value) => value !== null,
                      ).length,
                  }
              }
            : null))
    }

    for (const result of results) console.log(JSON.stringify(result))
    const usableChainIds = new Set(
        results.filter((result) => result.outcome === 'success')
            .map((result) => result.chainId),
    )
    console.log(JSON.stringify({
        operation: 'summary',
        requestedChainIds: chains.map((chain) => chain.chainId),
        usableChainIds: [...usableChainIds],
        unavailableChainIds: chains
            .map((chain) => chain.chainId)
            .filter((value) => !usableChainIds.has(value)),
    }))
    process.exitCode = usableChainIds.size > 0 ? 0 : 1
}

main().catch(() => {
    console.error('Market token diagnostic failed safely.')
    process.exitCode = 1
})
