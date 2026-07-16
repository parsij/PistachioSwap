import { getApiConfig } from '../../config.js'
import { ProviderError } from '../../lib/errors.js'
import { fetchJson, isRecord } from '../../lib/http.js'
import {
    decimalInteger,
    futureExpiry,
    normalizeTransaction,
    quoteId,
} from './quote-utils.js'
import type { NormalizedQuote, QuoteProvider } from './types.js'
import { normalizeProviderToken } from './provider-token.js'

export function createUniswapProvider(): QuoteProvider {
    const config = getApiConfig()

    return {
        name: 'uniswap',
        supportsChain: (chainId) => chainId === 56,

        async getQuote(request, signal) {
            if (!config.quotes.uniswap.apiKey) {
                throw new ProviderError({
                    code: 'UNISWAP_NOT_CONFIGURED',
                    message: 'Uniswap Trading API is not configured.',
                    statusCode: 503,
                    outcome: 'configuration',
                })
            }
            const sellToken = normalizeProviderToken({
                chainId: request.chainId,
                address: request.sellToken,
                isNative: request.sellToken === '0x0000000000000000000000000000000000000000',
            })
            const buyToken = normalizeProviderToken({
                chainId: request.chainId,
                address: request.buyToken,
                isNative: request.buyToken === '0x0000000000000000000000000000000000000000',
            })

            const headers = {
                'x-api-key': config.quotes.uniswap.apiKey,
            }
            let quotePayload: unknown
            try {
                quotePayload = await fetchJson(
                    new URL(`${config.quotes.uniswap.baseUrl}/quote`),
                    {
                        method: 'POST',
                        headers,
                        body: {
                            tokenIn: sellToken.uniswap,
                            tokenOut: buyToken.uniswap,
                            tokenInChainId: request.chainId,
                            tokenOutChainId: request.chainId,
                            type: 'EXACT_INPUT',
                            amount: request.sellAmount,
                            swapper: request.takerAddress,
                            slippageTolerance: request.slippageBps / 100,
                        },
                        signal,
                        timeoutMs: config.quotes.timeoutMs,
                    },
                )
            } catch (error) {
                if (
                    error instanceof ProviderError &&
                    error.upstreamStatus === 404
                ) {
                    throw new ProviderError({
                        code: 'UNISWAP_NO_ROUTE',
                        message: 'Uniswap reported no route for this pair.',
                        outcome: 'no-route',
                        upstreamStatus: 404,
                        cause: error,
                    })
                }
                throw error
            }

            if (!isRecord(quotePayload) || !isRecord(quotePayload.quote)) {
                throw new ProviderError({
                    code: 'UNISWAP_QUOTE_INVALID',
                    message: 'Uniswap returned an invalid quote.',
                })
            }

            const routing = String(quotePayload.routing ?? '')
            if (!['CLASSIC', 'WRAP', 'UNWRAP'].includes(routing)) {
                throw new ProviderError({
                    code:
                        routing === 'CHAINED'
                            ? 'UNISWAP_CHAINED_ROUTE_UNSUPPORTED'
                            : 'UNISWAP_ORDER_ROUTE_UNSUPPORTED',
                    message:
                        routing === 'CHAINED'
                            ? 'The Uniswap CHAINED route requires the plan workflow, which is not implemented.'
                            : `The Uniswap ${routing || 'unknown'} route requires an order-signature workflow, which is not implemented.`,
                    outcome: 'configuration',
                })
            }

            const swapPayload = await fetchJson(
                new URL(`${config.quotes.uniswap.baseUrl}/swap`),
                {
                    method: 'POST',
                    headers,
                    body: { quote: quotePayload.quote },
                    signal,
                    timeoutMs: config.quotes.timeoutMs,
                },
            )

            if (!isRecord(swapPayload)) {
                throw new ProviderError({
                    code: 'UNISWAP_SWAP_INVALID',
                    message: 'Uniswap returned an invalid swap transaction.',
                })
            }

            const rawQuote = quotePayload.quote
            const input = isRecord(rawQuote.input) ? rawQuote.input : {}
            const output = isRecord(rawQuote.output) ? rawQuote.output : {}
            const buyAmount = decimalInteger(output.amount)
            const aggregated = Array.isArray(rawQuote.aggregatedOutputs)
                ? rawQuote.aggregatedOutputs
                : []
            const userOutput = aggregated.find(
                (item) =>
                    isRecord(item) &&
                    String(item.fee ?? '') !== 'INTEGRATOR',
            )
            const minimum =
                (isRecord(userOutput)
                    ? decimalInteger(userOutput.minAmount ?? userOutput.amount)
                    : null) ??
                (buyAmount
                    ? (
                          (BigInt(buyAmount) *
                              BigInt(10_000 - request.slippageBps)) /
                          10_000n
                      ).toString()
                    : null)

            if (!buyAmount || !minimum) {
                throw new ProviderError({
                    code: 'UNISWAP_QUOTE_INVALID',
                    message: 'Uniswap quote amounts are invalid.',
                })
            }

            const transaction = normalizeTransaction(swapPayload.swap)
            const normalized: NormalizedQuote = {
                provider: 'uniswap',
                billingMode: 'normal-provider-fee',
                quoteId: quoteId(rawQuote.quoteId, 'uniswap'),
                chainId: request.chainId,
                sellToken: request.sellToken,
                buyToken: request.buyToken,
                sellAmount:
                    decimalInteger(input.amount) ?? request.sellAmount,
                buyAmount,
                minimumBuyAmount: minimum,
                estimatedGas:
                    decimalInteger(rawQuote.gasUseEstimate) ??
                    transaction.gas ??
                    null,
                estimatedGasUsd:
                    typeof rawQuote.gasFeeUSD === 'string'
                        ? rawQuote.gasFeeUSD
                        : null,
                allowanceTarget:
                    request.sellToken ===
                    '0x0000000000000000000000000000000000000000'
                        ? null
                        : isRecord(quotePayload.permitData) &&
                            isRecord(quotePayload.permitData.values) &&
                            typeof quotePayload.permitData.values.spender ===
                                'string'
                          ? quotePayload.permitData.values.spender
                          : null,
                transaction,
                platformFee: { amount: '0', token: null, bps: 0 },
                route: Array.isArray(rawQuote.route)
                    ? rawQuote.route
                    : [],
                permitData: quotePayload.permitData ?? null,
                executable: true,
                expiresAt: futureExpiry(30),
            }
            return normalized
        },

        async healthCheck(signal) {
            if (!config.quotes.uniswap.apiKey) return false
            try {
                const response = await fetch(
                    `${config.quotes.uniswap.baseUrl}/api.json`,
                    { signal },
                )
                return response.ok
            } catch {
                return false
            }
        },
    }
}
