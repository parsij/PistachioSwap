import { getApiConfig } from '../../config.js'
import {
    ProviderError,
    type ProviderDiagnostic,
} from '../../lib/errors.js'
import { createPancakeSwapProvider } from './pancakeswap-provider.js'
import { assertNormalizedQuote } from './quote-utils.js'
import type {
    NormalizedQuote,
    QuoteProvider,
    QuoteRequest,
    QuoteSelection,
    QuoteSummary,
} from './types.js'
import { createUniswapProvider } from './uniswap-provider.js'
import { createZeroXProvider } from './zero-x-provider.js'

function withTimeout(
    provider: QuoteProvider,
    request: QuoteRequest,
    timeoutMs: number,
    signal?: AbortSignal,
) {
    const timeout = AbortSignal.timeout(timeoutMs)
    const combined = signal
        ? AbortSignal.any([signal, timeout])
        : timeout
    return provider.getQuote(request, combined)
}

export function selectBestQuote(quotes: NormalizedQuote[]) {
    if (quotes.length === 0) {
        throw new ProviderError({
            code: 'NO_ROUTE_AVAILABLE',
            message: 'No enabled provider returned a valid route.',
            statusCode: 503,
            outcome: 'no-route',
        })
    }

    return [...quotes].sort((left, right) => {
        const leftNet = BigInt(left.buyAmount)
        const rightNet = BigInt(right.buyAmount)

        // Provider buy amounts are their post-fee executable outputs for the
        // same exact input. Fee metadata remains informational because it may
        // be denominated in either side of the trade.
        if (leftNet === rightNet) return 0
        return leftNet > rightNet ? -1 : 1
    })[0]
}

export function createQuoteSelector(
    providedProviders?: QuoteProvider[],
) {
    const config = getApiConfig()
    const providers =
        providedProviders ??
        [
            createUniswapProvider(),
            createZeroXProvider(),
            createPancakeSwapProvider(),
        ]
    const enabledProviderNames = new Set(config.quotes.providers)
    const enabled = providers.filter((provider) => {
        if (!enabledProviderNames.has(provider.name)) return false
        if (
            provider.name === 'uniswap' &&
            !config.quotes.uniswap.enabled
        ) {
            return false
        }
        if (provider.name === '0x' && !config.quotes.zeroX.enabled) {
            return false
        }
        if (
            provider.name === 'pancakeswap' &&
            !config.quotes.pancakeSwap.enabled
        ) {
            return false
        }
        return (
            config.quotes.mode === 'best' ||
            provider.name === config.quotes.mode
        )
    })

    return async function selectQuotes(
        request: QuoteRequest,
        signal?: AbortSignal,
    ): Promise<QuoteSelection> {
        const compatible = enabled.filter((provider) =>
            provider.supportsChain(request.chainId),
        )
        const settled = await Promise.allSettled(
            compatible.map((provider) =>
                withTimeout(
                    provider,
                    request,
                    config.quotes.timeoutMs,
                    signal,
                ).then(assertNormalizedQuote),
            ),
        )
        const quotes: NormalizedQuote[] = []
        const diagnostics: ProviderDiagnostic[] = []
        const summaries: QuoteSummary[] = settled.map((result, index) => {
            const provider = compatible[index]
            if (result.status === 'fulfilled') {
                quotes.push(result.value)
                return {
                    provider: provider.name,
                    status: 'fulfilled',
                    buyAmount: result.value.buyAmount,
                    minimumBuyAmount: result.value.minimumBuyAmount,
                    estimatedGasUsd: result.value.estimatedGasUsd,
                    platformFee: result.value.platformFee,
                    error: null,
                }
            }

            const providerError = result.reason instanceof ProviderError
                ? result.reason
                : null
            diagnostics.push({
                provider: provider.name,
                outcome: providerError?.outcome ?? 'upstream',
                upstreamStatus: providerError?.upstreamStatus ?? null,
                code: providerError?.code ?? null,
                message:
                    providerError?.message.slice(0, 240) ??
                    'Provider failed without a safe diagnostic.',
            })

            return {
                provider: provider.name,
                status: 'rejected',
                buyAmount: null,
                minimumBuyAmount: null,
                estimatedGasUsd: null,
                platformFee: null,
                error:
                    providerError
                        ? providerError.code
                        : 'PROVIDER_FAILED',
            }
        })

        if (quotes.length === 0) {
            throw new ProviderError({
                code: 'NO_ROUTE_AVAILABLE',
                message: 'No enabled provider returned a valid route.',
                statusCode: 503,
                outcome: 'no-route',
                providers: diagnostics,
            })
        }

        return {
            selectedQuote: selectBestQuote(quotes),
            providers: summaries,
        }
    }
}
