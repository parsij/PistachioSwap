import { getApiConfig } from '../config.js'
import { createAcrossAdapter } from './adapters/across/index.js'
import { createChainflipAdapter } from './adapters/chainflip/index.js'
import { createDebridgeAdapter } from './adapters/debridge/index.js'
import { createRelayAdapter } from './adapters/relay/index.js'
import { createZeroXCrossChainAdapter } from './adapters/zero-x/index.js'
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
import { CrossChainValidationError } from './validation.js'

type ProviderFailure = {
    provider: CrossChainProviderName
    code: string
    reason: string
}

type SkippedProvider = {
    provider: CrossChainProviderName
    code: string
}

type QuoteResult = {
    selectedQuote: CrossChainQuote
    quotes: CrossChainQuote[]
    failures: ProviderFailure[]
    eligibleProviders: CrossChainProviderName[]
    skippedProviders: SkippedProvider[]
    attemptedProviders: CrossChainProviderName[]
}

export class CrossChainQuoteError extends Error {
    readonly statusCode = 503
    constructor(
        readonly code: string,
        message: string,
        readonly failures: ProviderFailure[] = [],
        readonly eligibleProviders: CrossChainProviderName[] = [],
        readonly skippedProviders: SkippedProvider[] = [],
        readonly attemptedProviders: CrossChainProviderName[] = [],
    ) {
        super(message)
    }
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
        const capabilityResults = await Promise.all(this.providerNames().map(async (provider) => {
            try {
                return {
                    provider,
                    capabilities: await this.getCapabilities(provider, signal),
                    error: null,
                }
            } catch (error) {
                return {
                    provider,
                    capabilities: null,
                    error: error instanceof Error ? error.message : 'Capability discovery failed.',
                }
            }
        }))
        const available = capabilityResults.flatMap((result) =>
            result.capabilities?.available
                ? [{ provider: result.provider, capabilities: result.capabilities }]
                : [],
        )
        const capabilitySkipped: SkippedProvider[] = capabilityResults.flatMap((result) => {
            if (result.capabilities?.available) return []
            const reason = result.capabilities?.reason ?? result.error ?? ''
            return [{
                provider: result.provider,
                code: /disabled|not configured|credential/i.test(reason)
                    ? 'NOT_CONFIGURED'
                    : 'CAPABILITY_UNAVAILABLE',
            }]
        })
        if (!available.length) {
            const notConfigured = capabilityResults.every((result) =>
                result.capabilities !== null && /disabled|not configured|credential/i.test(
                    result.capabilities.reason ?? '',
                ),
            )
            throw new CrossChainQuoteError(
                notConfigured ? 'CROSS_CHAIN_NOT_CONFIGURED' : 'CROSS_CHAIN_PROVIDER_UNAVAILABLE',
                notConfigured
                    ? 'Cross-chain routing is not configured.'
                    : 'Cross-chain providers are temporarily unavailable.',
                [],
                [],
                capabilitySkipped,
                [],
            )
        }
        const chainPairProviders = available.filter(({ capabilities }) =>
            capabilities.routes.some((route) =>
                route.sourceChainId === request.sourceAsset.chainId &&
                route.destinationChainId === request.destinationAsset.chainId,
            ),
        )
        if (!chainPairProviders.length) {
            const skippedProviders = [
                ...capabilitySkipped,
                ...available.map(({ provider }) => ({
                    provider,
                    code: 'UNSUPPORTED_CHAIN_PAIR',
                })),
            ]
            throw new CrossChainQuoteError(
                'CROSS_CHAIN_UNSUPPORTED_CHAIN_PAIR',
                'This network pair is not currently supported.',
                [], [], skippedProviders, [],
            )
        }
        const eligibleProviders = chainPairProviders.filter(({ capabilities }) =>
            routeSupportsRequest(capabilities, request),
        )
        if (!eligibleProviders.length) {
            const skippedProviders = [
                ...capabilitySkipped,
                ...available.filter(({ provider }) =>
                    !chainPairProviders.some((candidate) => candidate.provider === provider),
                ).map(({ provider }) => ({ provider, code: 'UNSUPPORTED_CHAIN_PAIR' })),
                ...chainPairProviders.map(({ provider }) => ({
                    provider,
                    code: 'UNSUPPORTED_TOKEN_PAIR',
                })),
            ]
            throw new CrossChainQuoteError(
                'CROSS_CHAIN_UNSUPPORTED_TOKEN_PAIR',
                'This token pair is not currently supported across these networks.',
                [], [], skippedProviders, [],
            )
        }
        const selectedProviderNames = eligibleProviders.map(({ provider }) => provider)
        const selectedProviderSet = new Set(selectedProviderNames)
        const skippedProviders = [
            ...capabilitySkipped,
            ...available.filter(({ provider }) =>
                !chainPairProviders.some((candidate) => candidate.provider === provider),
            ).map(({ provider }) => ({ provider, code: 'UNSUPPORTED_CHAIN_PAIR' })),
            ...chainPairProviders.filter(({ provider }) =>
                !selectedProviderSet.has(provider),
            ).map(({ provider }) => ({ provider, code: 'UNSUPPORTED_TOKEN_PAIR' })),
        ]
        const settled = await Promise.all(eligibleProviders.map(async ({ provider, capabilities }) => {
            const adapter = this.requireAdapter(provider)
            try {
                const quote = await this.run(provider, () =>
                    adapter.getQuote(request, capabilities, signal),
                )
                if (
                    quote.request.destinationAsset.chainId !== request.destinationAsset.chainId ||
                    quote.request.destinationAsset.address !== request.destinationAsset.address ||
                    quote.request.recipient !== request.recipient ||
                    BigInt(quote.minimumBuyAmount) <= 0n
                ) throw new Error('Provider route does not deliver the selected destination asset.')
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
                    code: classifyProviderFailure(error),
                    reason: error instanceof Error ? error.message : 'Provider failed.',
                }
            }
        }))
        const quotes: CrossChainQuote[] = []
        for (const result of settled) {
            if ('quote' in result && result.quote) quotes.push(result.quote)
        }
        const failures = settled.flatMap((result) =>
            'quote' in result ? [] : [{
                provider: result.provider,
                code: result.code,
                reason: result.reason,
            }],
        )
        if (!quotes.length) {
            const detailed = settled.flatMap((result) => 'quote' in result ? [] : [{
                provider: result.provider,
                code: result.code,
                reason: result.reason,
            }])
            const codes = new Set(detailed.map((failure) => failure.code))
            const code = codes.size === 1 && codes.has('AMOUNT_TOO_LOW')
                ? 'CROSS_CHAIN_AMOUNT_TOO_LOW'
                : codes.size === 1 && codes.has('AMOUNT_TOO_HIGH')
                  ? 'CROSS_CHAIN_AMOUNT_TOO_HIGH'
                  : codes.has('RATE_LIMITED')
                    ? 'CROSS_CHAIN_PROVIDER_RATE_LIMITED'
                    : codes.has('NO_LIQUIDITY')
                      ? 'CROSS_CHAIN_NO_LIQUIDITY'
                      : codes.has('ACROSS_AUTHORITY_UNAVAILABLE')
                        ? 'ACROSS_AUTHORITY_UNAVAILABLE'
                        : codes.has('ACROSS_APPROVAL_TARGET_INVALID')
                          ? 'ACROSS_APPROVAL_TARGET_INVALID'
                          : codes.has('ACROSS_APPROVAL_AMOUNT_INVALID')
                            ? 'ACROSS_APPROVAL_AMOUNT_INVALID'
                            : codes.has('ACROSS_ROUTE_MALFORMED')
                              ? 'ACROSS_ROUTE_MALFORMED'
                      : codes.has('RELAY_AUTHORITY_UNAVAILABLE')
                        ? 'RELAY_AUTHORITY_UNAVAILABLE'
                        : codes.has('RELAY_APPROVAL_TARGET_INVALID')
                          ? 'RELAY_APPROVAL_TARGET_INVALID'
                          : codes.has('RELAY_APPROVAL_AMOUNT_INVALID')
                            ? 'RELAY_APPROVAL_AMOUNT_INVALID'
                            : codes.has('RELAY_ROUTE_MALFORMED')
                              ? 'RELAY_ROUTE_MALFORMED'
                      : codes.has('UNAVAILABLE')
                        ? 'CROSS_CHAIN_PROVIDER_UNAVAILABLE'
                        : 'CROSS_CHAIN_NO_EXECUTABLE_ROUTE'
            throw new CrossChainQuoteError(
                code,
                errorMessage(code),
                detailed,
                selectedProviderNames,
                skippedProviders,
                selectedProviderNames,
            )
        }
        quotes.sort(compareQuotes)
        this.pruneQuotes()
        return {
            selectedQuote: quotes[0],
            quotes,
            failures,
            eligibleProviders: selectedProviderNames,
            skippedProviders,
            attemptedProviders: selectedProviderNames,
        }
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
        sourceTransactionHash?: string,
    ): Promise<CrossChainStatusResult> {
        if (!/^[a-zA-Z0-9:_\-.]{1,256}$/.test(statusId)) {
            throw new Error('Invalid status identifier.')
        }
        const adapter = this.requireAdapter(provider)
        return this.run(provider, () =>
            adapter.getStatus(statusId, signal, sourceTransactionHash),
        )
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

function classifyProviderFailure(error: unknown) {
    if (error instanceof CrossChainValidationError) return error.code
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    if (/amount.*too low|minimum amount|below.*minimum/.test(message)) return 'AMOUNT_TOO_LOW'
    if (/amount.*too high|maximum amount|above.*maximum/.test(message)) return 'AMOUNT_TOO_HIGH'
    if (/rate limit|too many requests|\b429\b/.test(message)) return 'RATE_LIMITED'
    if (/liquidity|no route|no quote/.test(message)) return 'NO_LIQUIDITY'
    if (/timeout|unavailable|upstream|fetch/.test(message)) return 'UNAVAILABLE'
    return 'INVALID_ROUTE'
}

function errorMessage(code: string) {
    return {
        CROSS_CHAIN_AMOUNT_TOO_LOW: 'Enter a larger amount for this cross-chain swap.',
        CROSS_CHAIN_AMOUNT_TOO_HIGH: 'Enter a smaller amount for this cross-chain swap.',
        CROSS_CHAIN_NO_LIQUIDITY: 'No cross-chain liquidity is currently available for this token pair.',
        CROSS_CHAIN_PROVIDER_RATE_LIMITED: 'Cross-chain providers are temporarily rate limited.',
        CROSS_CHAIN_PROVIDER_UNAVAILABLE: 'Cross-chain providers are temporarily unavailable.',
        ACROSS_AUTHORITY_UNAVAILABLE: 'Across authority metadata is temporarily unavailable.',
        ACROSS_APPROVAL_TARGET_INVALID: 'Across returned an unauthorized approval target.',
        ACROSS_APPROVAL_AMOUNT_INVALID: 'Across returned an invalid approval amount.',
        ACROSS_ROUTE_MALFORMED: 'Across returned a malformed route.',
        RELAY_AUTHORITY_UNAVAILABLE: 'Relay authority metadata is temporarily unavailable.',
        RELAY_APPROVAL_TARGET_INVALID: 'Relay returned an unauthorized approval target.',
        RELAY_APPROVAL_AMOUNT_INVALID: 'Relay returned an invalid approval amount.',
        RELAY_ROUTE_MALFORMED: 'Relay returned a malformed route.',
        CROSS_CHAIN_NO_EXECUTABLE_ROUTE: 'No executable cross-chain route is currently available.',
    }[code] ?? 'No executable cross-chain route is currently available.'
}

function defaultAdapters(): CrossChainAdapter[] {
    const config = getApiConfig().crossChain
    return [
        createAcrossAdapter(),
        createDebridgeAdapter(),
        createRelayAdapter(),
        ...(config.chainflip.enabled ? [createChainflipAdapter()] : []),
        ...(config.zeroX.enabled ? [createZeroXCrossChainAdapter()] : []),
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
