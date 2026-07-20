import { pathToFileURL } from 'node:url'

import { CURATED_EVM_CHAINS } from '../src/chains.js'
import { getApiConfig } from '../src/config.js'
import { createAcrossAdapter } from '../src/cross-chain/adapters/across/index.js'
import { createChainflipAdapter } from '../src/cross-chain/adapters/chainflip/index.js'
import { createDebridgeAdapter } from '../src/cross-chain/adapters/debridge/index.js'
import { createRelayAdapter } from '../src/cross-chain/adapters/relay/index.js'
import type {
    CrossChainAdapter,
    CrossChainProviderName,
    CrossChainRequest,
    ProviderCapabilities,
} from '../src/cross-chain/types.js'
import { routeSupportsRequest } from '../src/cross-chain/validation.js'

const DIAGNOSTIC_TIMEOUT_MS = 15_000
const OWNER = '0x0000000000000000000000000000000000000001'
const TOKEN_BY_CHAIN: Readonly<Record<number, string>> = {
    1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    56: '0x55d398326f99059ff775485246999027b3197955',
    8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    42161: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
}

type DiagnosticState = {
    adapter: CrossChainAdapter
    capabilities: ProviderCapabilities
    auth: 'READY' | 'PARTIAL' | 'SKIPPED'
    note: string
}

export async function runCrossChainProviderDiagnostic() {
    const config = getApiConfig()
    const adapters = [
        createAcrossAdapter(),
        createDebridgeAdapter(),
        createRelayAdapter(),
        createChainflipAdapter(),
    ]
    const auth = authStates(config)

    console.log('Cross-chain provider diagnostic (read-only, finite)')
    console.log(`Chains: ${CURATED_EVM_CHAINS.length}; per-operation timeout: ${DIAGNOSTIC_TIMEOUT_MS}ms`)
    console.table([
        {
            provider: 'Across',
            endpoint: publicUrl(config.crossChain.across.baseUrl),
            auth: auth.across.auth,
            note: auth.across.note,
        },
        {
            provider: 'deBridge DLN',
            endpoint: publicUrl(config.crossChain.debridge.baseUrl),
            auth: auth['debridge-dln'].auth,
            note: auth['debridge-dln'].note,
        },
        {
            provider: 'Relay',
            endpoint: publicUrl(config.crossChain.relay.baseUrl),
            auth: auth.relay.auth,
            note: auth.relay.note,
        },
        {
            provider: 'Chainflip',
            endpoint: config.crossChain.chainflip.brokerApiUrl
                ? publicUrl(config.crossChain.chainflip.brokerApiUrl)
                : '[not configured]',
            auth: auth.chainflip.auth,
            note: auth.chainflip.note,
        },
    ])

    const states = await Promise.all(adapters.map(async (adapter): Promise<DiagnosticState> => {
        const configured = auth[adapter.name]
        if (configured.auth === 'SKIPPED') {
            return {
                adapter,
                auth: configured.auth,
                note: configured.note,
                capabilities: unavailable(adapter.name, configured.note),
            }
        }
        try {
            const capabilities = await finite(
                (signal) => adapter.getCapabilities(signal),
            )
            return { adapter, capabilities, ...configured }
        } catch (error) {
            return {
                adapter,
                auth: configured.auth,
                note: safeMessage(error),
                capabilities: unavailable(adapter.name, safeMessage(error)),
            }
        }
    }))

    console.log('\n25-chain capability matrix')
    console.table(CURATED_EVM_CHAINS.map((chain) => {
        const row: Record<string, string | number> = {
            chainId: chain.id,
            chain: chain.name,
        }
        for (const state of states) {
            row[state.adapter.name] = matrixStatus(state, chain.id)
        }
        return row
    }))

    console.log('\nIndicative exact-input quote diagnostics (one bounded attempt per provider)')
    for (const state of states) {
        const request = diagnosticRequest(state.capabilities)
        if (state.auth === 'SKIPPED') {
            printQuote(state.adapter.name, 'SKIPPED', state.note)
        } else if (!request) {
            printQuote(state.adapter.name, 'UNSUPPORTED', 'No exact indicative route in current capabilities.')
        } else {
            try {
                // Quote only: deliberately never call prepare(), execute, signing, or submission APIs.
                const quote = await finite(
                    (signal) => state.adapter.getQuote(request, state.capabilities, signal),
                )
                printQuote(state.adapter.name, state.auth === 'PARTIAL' ? 'PARTIAL' : 'SUPPORTED', {
                    route: `${request.sourceAsset.chainId}->${request.destinationAsset.chainId}`,
                    executionModel: quote.executionModel,
                    buyAmount: quote.buyAmount,
                    minimumBuyAmount: quote.minimumBuyAmount,
                    feeTypes: quote.fees.map(({ type }) => type).join(', ') || 'none reported',
                    estimatedDurationSeconds: quote.estimatedDurationSeconds,
                })
            } catch (error) {
                printQuote(
                    state.adapter.name,
                    state.auth === 'PARTIAL' ? 'PARTIAL' : 'UNSUPPORTED',
                    safeMessage(error),
                )
            }
        }
    }

    console.log('\nDiagnostic complete. No server, signature, broadcast, route execution, or deposit-address request was made.')
}

function authStates(config: ReturnType<typeof getApiConfig>) {
    return {
        across: config.crossChain.across.enabled
            ? config.crossChain.across.apiKey
                ? ready()
                : partial('No API key; public capability/quote access only.')
            : skipped('Provider is disabled.'),
        'debridge-dln': config.crossChain.debridge.enabled
            ? config.crossChain.debridge.accessToken
                ? ready()
                : partial('No access token; public capability/quote access only.')
            : skipped('Provider is disabled.'),
        relay: config.crossChain.relay.enabled
            ? config.crossChain.relay.apiKey
                ? ready()
                : partial('No API key; public capability/quote access only.')
            : skipped('Provider is disabled.'),
        chainflip: !config.crossChain.chainflip.enabled
            ? skipped('Provider is disabled.')
            : config.crossChain.chainflip.brokerApiUrl
                ? ready()
                : partial('No broker URL; discovery and quotes only, execution unavailable.'),
        '0x-cross-chain': !config.crossChain.zeroX.enabled
            ? skipped('Provider is disabled.')
            : config.crossChain.zeroX.apiKey
                ? ready()
                : partial('No 0x API key; provider unavailable.'),
    } satisfies Record<CrossChainProviderName, {
        auth: 'READY' | 'PARTIAL' | 'SKIPPED'
        note: string
    }>
}

function ready() {
    return { auth: 'READY' as const, note: 'Configured.' }
}
function partial(note: string) {
    return { auth: 'PARTIAL' as const, note }
}
function skipped(note: string) {
    return { auth: 'SKIPPED' as const, note }
}

function matrixStatus(state: DiagnosticState, chainId: number) {
    if (state.auth === 'SKIPPED') return 'SKIPPED'
    const source = state.capabilities.routes.some((route) => route.sourceChainId === chainId)
    const destination = state.capabilities.routes.some((route) => route.destinationChainId === chainId)
    if (!source && !destination) return 'UNSUPPORTED'
    const directions = source && destination ? 'source+destination' : source ? 'source' : 'destination'
    return state.auth === 'PARTIAL'
        ? `PARTIAL (${directions})`
        : `SUPPORTED (${directions})`
}

function diagnosticRequest(capabilities: ProviderCapabilities): CrossChainRequest | null {
    const preferredPairs = [
        [1, 8453],
        [8453, 1],
        [1, 42161],
        [56, 1],
    ] as const
    for (const [sourceChainId, destinationChainId] of preferredPairs) {
        const route = capabilities.routes.find((candidate) =>
            candidate.sourceChainId === sourceChainId &&
            candidate.destinationChainId === destinationChainId,
        )
        if (!route) continue
        const source = route.sellTokens?.[0] ?? TOKEN_BY_CHAIN[sourceChainId]
        const destination = route.buyTokens?.[0] ?? TOKEN_BY_CHAIN[destinationChainId]
        if (!source || !destination) continue
        const request: CrossChainRequest = {
            mode: 'exactIn',
            sourceAsset: { chainId: sourceChainId, address: source, symbol: null, decimals: null },
            destinationAsset: {
                chainId: destinationChainId,
                address: destination,
                symbol: null,
                decimals: null,
            },
            amount: '1000000',
            ownerAddress: OWNER,
            recipient: OWNER,
            slippageBps: 50,
            walletCapabilities: {
                evmTransaction: true,
                depositChannel: true,
                vaultSwap: false,
            },
        }
        if (routeSupportsRequest(capabilities, request)) return request
    }
    return null
}

async function finite<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(
        () => controller.abort(new Error('Diagnostic operation timed out.')),
        DIAGNOSTIC_TIMEOUT_MS,
    )
    try {
        return await operation(controller.signal)
    } finally {
        clearTimeout(timer)
    }
}

function unavailable(provider: CrossChainProviderName, reason: string): ProviderCapabilities {
    return {
        provider,
        available: false,
        fetchedAt: new Date().toISOString(),
        routes: [],
        reason,
    }
}

function publicUrl(value: string) {
    try {
        const url = new URL(value)
        url.username = ''
        url.password = ''
        url.search = ''
        url.hash = ''
        return url.toString().replace(/\/$/, '')
    } catch {
        return '[redacted invalid URL]'
    }
}

function safeMessage(error: unknown) {
    const raw = error instanceof Error ? error.message : 'Provider request failed.'
    return raw
        .replace(/bearer\s+\S+/gi, 'Bearer [REDACTED]')
        .replace(/(api[-_ ]?key|access[-_ ]?token|authorization)([=:]\s*)\S+/gi, '$1$2[REDACTED]')
        .replace(/https?:\/\/\S+/gi, (candidate) => publicUrl(candidate))
        .slice(0, 300)
}

function printQuote(
    provider: CrossChainProviderName,
    status: 'SUPPORTED' | 'PARTIAL' | 'SKIPPED' | 'UNSUPPORTED',
    detail: unknown,
) {
    console.log(JSON.stringify({ provider, status, detail }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runCrossChainProviderDiagnostic().catch((error) => {
        console.error(`Diagnostic failed: ${safeMessage(error)}`)
        process.exitCode = 1
    })
}
