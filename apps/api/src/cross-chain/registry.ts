import { getApiConfig } from '../config.js'
import { createAcrossAdapter } from './adapters/across/index.js'
import { createChainflipAdapter } from './adapters/chainflip/index.js'
import { createDebridgeAdapter } from './adapters/debridge/index.js'
import { createRelayAdapter } from './adapters/relay/index.js'
import { CapabilityCache, ProviderControls } from './controls.js'
import type {
    CrossChainAdapter,
    CrossChainProviderName,
    CrossChainQuote,
    CrossChainRequest,
    CrossChainStatusResult,
    ProviderCapabilities,
} from './types.js'
import { routeSupportsRequest } from './validation.js'

type QuoteResult = {
    selectedQuote: CrossChainQuote
    quotes: CrossChainQuote[]
    failures: Array<{ provider: CrossChainProviderName; reason: string }>
}

export class CrossChainRegistry {
    private readonly adapters = new Map<CrossChainProviderName, CrossChainAdapter>()
    private readonly controls = new Map<CrossChainProviderName, ProviderControls>()
    private readonly capabilities = new CapabilityCache()
    private readonly quotes = new Map<string, CrossChainQuote>()
    private readonly config = getApiConfig().crossChain

    constructor(adapters: CrossChainAdapter[] = defaultAdapters()) {
        for (const adapter of adapters) {
            this.adapters.set(adapter.name, adapter)
            this.controls.set(adapter.name, new ProviderControls(4, 25))
        }
    }

    providerNames() {
        return [...this.adapters.keys()]
    }

    async getCapabilities(
        provider: CrossChainProviderName,
        signal?: AbortSignal,
    ): Promise<ProviderCapabilities> {
        const adapter = this.requireAdapter(provider)
        return this.capabilities.get(
            provider,
            () => this.run(provider, () => adapter.getCapabilities(signal)),
            this.config.capabilityTtlMs,
            this.config.negativeCapabilityTtlMs,
        )
    }

    async getAllCapabilities(signal?: AbortSignal) {
        return Promise.all(this.providerNames().map(async (provider) => {
            try {
                return await this.getCapabilities(provider, signal)
            } catch {
                return {
                    provider,
                    available: false,
                    fetchedAt: new Date().toISOString(),
                    routes: [],
                    reason: 'Capability discovery is temporarily unavailable.',
                } satisfies ProviderCapabilities
            }
        }))
    }

    async quote(
        request: CrossChainRequest,
        signal?: AbortSignal,
    ): Promise<QuoteResult> {
        const settled = await Promise.all(this.providerNames().map(async (provider) => {
            const adapter = this.requireAdapter(provider)
            try {
                const capabilities = await this.getCapabilities(provider, signal)
                if (!routeSupportsRequest(capabilities, request)) {
                    throw new Error('Route is not supported.')
                }
                const quote = await this.run(provider, () =>
                    adapter.getQuote(request, capabilities, signal),
                )
                if (
                    quote.executionModel === 'evm-transaction' &&
                    !request.walletCapabilities.evmTransaction
                ) throw new Error('Wallet does not support EVM transactions.')
                if (
                    quote.executionModel === 'deposit-channel' &&
                    !request.walletCapabilities.depositChannel
                ) throw new Error('Wallet does not support deposit channels.')
                if (Date.parse(quote.expiresAt) <= Date.now()) {
                    throw new Error('Provider quote is already expired.')
                }
                this.quotes.set(quote.quoteId, quote)
                return { quote }
            } catch (error) {
                return {
                    provider,
                    reason: error instanceof Error ? error.message : 'Provider failed.',
                }
            }
        }))
        const quotes: CrossChainQuote[] = []
        for (const result of settled) {
            if ('quote' in result && result.quote) quotes.push(result.quote)
        }
        const failures = settled.flatMap((result) =>
            'quote' in result ? [] : [{ provider: result.provider, reason: result.reason }],
        )
        if (!quotes.length) throw new Error('No cross-chain route is available.')
        quotes.sort(compareQuotes)
        this.pruneQuotes()
        return { selectedQuote: quotes[0], quotes, failures }
    }

    async prepare(quoteId: string, signal?: AbortSignal): Promise<CrossChainQuote> {
        this.pruneQuotes()
        const quote = this.quotes.get(quoteId)
        if (!quote) throw new Error('Quote is unknown or expired.')
        const adapter = this.requireAdapter(quote.provider)
        if (!adapter.prepare) return quote
        const prepared = await this.run(quote.provider, () =>
            adapter.prepare!(quote, signal),
        )
        this.quotes.set(quoteId, prepared)
        return prepared
    }

    async status(
        provider: CrossChainProviderName,
        statusId: string,
        signal?: AbortSignal,
    ): Promise<CrossChainStatusResult> {
        if (!/^[a-zA-Z0-9:_\-.]{1,256}$/.test(statusId)) {
            throw new Error('Invalid status identifier.')
        }
        const adapter = this.requireAdapter(provider)
        return this.run(provider, () => adapter.getStatus(statusId, signal))
    }

    private requireAdapter(provider: CrossChainProviderName) {
        const adapter = this.adapters.get(provider)
        if (!adapter) throw new Error('Cross-chain provider is not enabled.')
        return adapter
    }

    private run<T>(provider: CrossChainProviderName, operation: () => Promise<T>) {
        return this.controls.get(provider)!.run(operation)
    }

    private pruneQuotes() {
        const now = Date.now()
        for (const [id, quote] of this.quotes) {
            if (Date.parse(quote.expiresAt) <= now) this.quotes.delete(id)
        }
    }
}

function defaultAdapters(): CrossChainAdapter[] {
    const config = getApiConfig().crossChain
    return [
        createAcrossAdapter(),
        createDebridgeAdapter(),
        createRelayAdapter(),
        ...(config.chainflip.enabled ? [createChainflipAdapter()] : []),
    ]
}

function compareQuotes(left: CrossChainQuote, right: CrossChainQuote) {
    const leftNet = netOutput(left)
    const rightNet = netOutput(right)
    if (leftNet !== rightNet) return leftNet > rightNet ? -1 : 1
    return (left.estimatedDurationSeconds ?? Number.MAX_SAFE_INTEGER) -
        (right.estimatedDurationSeconds ?? Number.MAX_SAFE_INTEGER)
}

function netOutput(quote: CrossChainQuote) {
    const outputFees = quote.fees
        .filter((fee) =>
            fee.amount !== null &&
            fee.includedInQuote !== true &&
            fee.token.toLowerCase() === quote.request.destinationAsset.address,
        )
        .reduce((total, fee) => total + BigInt(fee.amount!), 0n)
    const amount = BigInt(quote.minimumBuyAmount)
    return outputFees >= amount ? 0n : amount - outputFees
}
