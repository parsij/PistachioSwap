import {
    SMART_ROUTER_ADDRESSES,
    SmartRouter,
    SwapRouter,
} from '@pancakeswap/smart-router'
import {
    CurrencyAmount,
    Native,
    Percent,
    Token,
    TradeType,
    type Currency,
} from '@pancakeswap/sdk'
import {
    createPublicClient,
    custom,
    type Address,
} from 'viem'
import { bsc } from 'viem/chains'

import { getApiConfig } from '../../config.js'
import {
    NATIVE_TOKEN_ADDRESS,
    normalizeAddress,
} from '../../lib/address.js'
import { ProviderError } from '../../lib/errors.js'
import { getTokenDecimalsBatch } from '../token-decimals.js'
import { getTokenMetadata } from '../alchemy/token-metadata.js'
import { futureExpiry, quoteId } from './quote-utils.js'
import { normalizeProviderToken } from './provider-token.js'
import type { QuoteProvider } from './types.js'

export const PANCAKE_ROUTING_CAPABILITIES = {
    poolTypes: ['V2', 'V3', 'STABLE'] as const,
    maxHops: 3,
    maxSplits: 2,
}

const POOL_TYPE_NAMES = [
    'V2',
    'V3',
    'STABLE',
    'INFINITY_CL',
    'INFINITY_BIN',
    'INFINITY_STABLE',
] as const

const PANCAKE_MULTICALL_WARNING_PREFIXES = [
    'Failed to get gas limit from chain',
    'Failed to fetch gas limit on chain',
] as const

let pancakeWarningFilterDepth = 0
let originalConsoleWarn: typeof console.warn | null = null

async function withoutUnsafePancakeSdkWarnings<T>(task: () => Promise<T>) {
    if (pancakeWarningFilterDepth === 0) {
        originalConsoleWarn = console.warn
        console.warn = (...args: unknown[]) => {
            const first = args[0]
            if (
                typeof first === 'string' &&
                PANCAKE_MULTICALL_WARNING_PREFIXES.some((prefix) =>
                    first.startsWith(prefix),
                )
            ) {
                return
            }
            originalConsoleWarn?.(...args)
        }
    }
    pancakeWarningFilterDepth += 1

    try {
        return await task()
    } finally {
        pancakeWarningFilterDepth -= 1
        if (pancakeWarningFilterDepth === 0 && originalConsoleWarn) {
            console.warn = originalConsoleWarn
            originalConsoleWarn = null
        }
    }
}

function poolTypeName(value: number) {
    return POOL_TYPE_NAMES[value] ?? `UNKNOWN_${value}`
}

async function createCurrency(
    address: string,
    signal?: AbortSignal,
): Promise<Currency> {
    if (address === NATIVE_TOKEN_ADDRESS) {
        return Native.onChain(56)
    }

    const metadata = await getTokenMetadata(56, address, signal)
    let decimals = metadata?.decimals ?? null

    if (decimals === null) {
        const values = await getTokenDecimalsBatch({
            addresses: [address],
            signal,
        })
        decimals = values.get(address) ?? null
    }

    if (decimals === null) {
        throw new ProviderError({
            code: 'PANCAKESWAP_TOKEN_DECIMALS_UNAVAILABLE',
            message: 'PancakeSwap could not resolve exact token decimals.',
            outcome: 'validation',
        })
    }

    return new Token(
        56,
        address as Address,
        decimals,
        metadata?.symbol ?? 'TOKEN',
        metadata?.name ?? `Token ${address.slice(0, 8)}`,
    )
}

function pancakeFailure(error: unknown, signal?: AbortSignal): ProviderError {
    if (error instanceof ProviderError) return error
    if (signal?.aborted) {
        return new ProviderError({
            code: 'PANCAKESWAP_TIMEOUT',
            message: 'PancakeSwap routing timed out.',
            outcome: 'timeout',
            cause: error,
        })
    }

    const status = findUpstreamStatus(error)

    return new ProviderError({
        code:
            status === 429
                ? 'PANCAKESWAP_RATE_LIMITED'
                : 'PANCAKESWAP_ROUTER_FAILED',
        message:
            status === 429
                ? 'PancakeSwap RPC rate limit was reached.'
                : 'PancakeSwap Smart Router failed to calculate a route.',
        outcome: status === 429 ? 'rate-limit' : 'upstream',
        upstreamStatus: status,
        cause: error,
    })
}

function findUpstreamStatus(error: unknown, depth = 0): number | null {
    if (depth > 5 || typeof error !== 'object' || error === null) return null

    if (
        'upstreamStatus' in error &&
        typeof error.upstreamStatus === 'number'
    ) {
        return error.upstreamStatus
    }
    if ('status' in error && typeof error.status === 'number') {
        return error.status
    }
    if ('code' in error && error.code === 429) return 429

    return 'cause' in error
        ? findUpstreamStatus(error.cause, depth + 1)
        : null
}

function createPancakeClient(
    rpcUrl: string,
    timeoutMs: number,
    signal?: AbortSignal,
) {
    const provider = {
        async request({
            method,
            params,
        }: {
            method: string
            params?: unknown[]
        }) {
            const timeout = AbortSignal.timeout(timeoutMs)
            const requestSignal = signal
                ? AbortSignal.any([signal, timeout])
                : timeout
            let response: Response

            try {
                response = await fetch(rpcUrl, {
                    method: 'POST',
                    headers: {
                        accept: 'application/json',
                        'content-type': 'application/json',
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method,
                        params: params ?? [],
                    }),
                    signal: requestSignal,
                })
            } catch (error) {
                if (requestSignal.aborted) throw error
                throw new ProviderError({
                    code: 'PANCAKESWAP_RPC_UNAVAILABLE',
                    message: 'PancakeSwap RPC request failed.',
                    outcome: 'upstream',
                    cause: error,
                })
            }

            if (!response.ok) {
                throw new ProviderError({
                    code:
                        response.status === 429
                            ? 'PANCAKESWAP_RATE_LIMITED'
                            : 'PANCAKESWAP_RPC_HTTP_ERROR',
                    message:
                        response.status === 429
                            ? 'PancakeSwap RPC rate limit was reached.'
                            : 'PancakeSwap RPC returned an HTTP error.',
                    outcome:
                        response.status === 429
                            ? 'rate-limit'
                            : 'upstream',
                    upstreamStatus: response.status,
                })
            }

            const payload = (await response.json()) as {
                result?: unknown
                error?: { code?: number }
            }
            if (payload.error) {
                const rateLimited = payload.error.code === 429 ||
                    payload.error.code === -32005
                throw new ProviderError({
                    code: rateLimited
                        ? 'PANCAKESWAP_RATE_LIMITED'
                        : 'PANCAKESWAP_RPC_ERROR',
                    message: rateLimited
                        ? 'PancakeSwap RPC rate limit was reached.'
                        : 'PancakeSwap RPC returned an error.',
                    outcome: rateLimited ? 'rate-limit' : 'upstream',
                    upstreamStatus: rateLimited ? 429 : null,
                })
            }

            return payload.result
        },
    }

    return createPublicClient({
        chain: bsc,
        transport: custom(provider, {
            key: 'pancakeswap-sanitized-rpc',
            name: 'PancakeSwap sanitized RPC',
            retryCount: 0,
        }),
        batch: { multicall: { batchSize: 204_800 } },
    })
}

export function resolvePancakePlatformFee() {
    const config = getApiConfig()

    if (
        config.fees.platformFeeBps > 0 &&
        config.fees.collectionMode === 'executor-contract'
    ) {
        throw new ProviderError({
            code: 'PANCAKESWAP_FEE_EXECUTOR_UNIMPLEMENTED',
            message:
                'PancakeSwap is excluded because executor-contract fee collection is not implemented.',
            outcome: 'configuration',
        })
    }

    // Pancake routes do not claim provider-affiliate collection.
    return { amount: '0', token: null, bps: 0 } as const
}

export function createPancakeSwapProvider(): QuoteProvider {
    const config = getApiConfig()
    const pancake = config.quotes.pancakeSwap

    return {
        name: 'pancakeswap',
        supportsChain: (chainId) => chainId === 56,

        async getQuote(request, signal) {
            if (!pancake.rpcUrl) {
                throw new ProviderError({
                    code: 'PANCAKESWAP_NOT_CONFIGURED',
                    message: 'PancakeSwap RPC routing is not configured.',
                    statusCode: 503,
                    outcome: 'configuration',
                })
            }

            const sellIdentity = normalizeProviderToken({
                chainId: request.chainId,
                address: request.sellToken,
                isNative: request.sellToken === NATIVE_TOKEN_ADDRESS,
            })
            const buyIdentity = normalizeProviderToken({
                chainId: request.chainId,
                address: request.buyToken,
                isNative: request.buyToken === NATIVE_TOKEN_ADDRESS,
            })
            const platformFee = resolvePancakePlatformFee()

            try {
                const [currencyIn, currencyOut] = await Promise.all([
                    createCurrency(sellIdentity.internal, signal),
                    createCurrency(buyIdentity.internal, signal),
                ])
                const client = createPancakeClient(
                    pancake.rpcUrl,
                    config.quotes.timeoutMs,
                    signal,
                )
                const onChainProvider = () => client
                const pools = await SmartRouter.getCandidatePools({
                    currencyA: currencyIn,
                    currencyB: currencyOut,
                    onChainProvider,
                })
                const trade = await withoutUnsafePancakeSdkWarnings(() =>
                    SmartRouter.getBestTrade(
                        CurrencyAmount.fromRawAmount(
                            currencyIn,
                            BigInt(request.sellAmount),
                        ),
                        currencyOut,
                        TradeType.EXACT_INPUT,
                        {
                            gasPriceWei: () => client.getGasPrice(),
                            maxHops: PANCAKE_ROUTING_CAPABILITIES.maxHops,
                            maxSplits: PANCAKE_ROUTING_CAPABILITIES.maxSplits,
                            poolProvider:
                                SmartRouter.createStaticPoolProvider(pools),
                            quoteProvider: SmartRouter.createQuoteProvider({
                                onChainProvider,
                                gasLimit: 20_000_000n,
                            }),
                            quoterOptimization: true,
                            signal,
                        },
                    ),
                )

                if (!trade || trade.outputAmount.quotient <= 0n) {
                    throw new ProviderError({
                        code: 'PANCAKESWAP_NO_ROUTE',
                        message: 'PancakeSwap Smart Router found no viable route.',
                        outcome: 'no-route',
                    })
                }

                const slippage = new Percent(request.slippageBps, 10_000)
                const minimumBuyAmount =
                    (trade.outputAmount.quotient *
                        BigInt(10_000 - request.slippageBps)) /
                    10_000n
                const call = SwapRouter.swapCallParameters(trade, {
                    recipient: request.takerAddress as Address,
                    slippageTolerance: slippage,
                    deadlineOrPreviousBlockhash:
                        Math.floor(Date.now() / 1000) + 1200,
                })
                const routerAddress = normalizeAddress(
                    SMART_ROUTER_ADDRESSES[56],
                )

                if (!routerAddress) {
                    throw new ProviderError({
                        code: 'PANCAKESWAP_ROUTER_ADDRESS_INVALID',
                        message: 'PancakeSwap SDK returned an invalid BSC router address.',
                        outcome: 'configuration',
                    })
                }

                return {
                    provider: 'pancakeswap',
                    billingMode: 'normal-provider-fee',
                    quoteId: quoteId(trade.quoteQueryHash, 'pancakeswap'),
                    chainId: request.chainId,
                    sellToken: request.sellToken,
                    buyToken: request.buyToken,
                    sellAmount: request.sellAmount,
                    buyAmount: trade.outputAmount.quotient.toString(),
                    minimumBuyAmount: minimumBuyAmount.toString(),
                    estimatedGas: trade.gasEstimate.toString(),
                    estimatedGasUsd:
                        trade.gasEstimateInUSD &&
                        trade.gasEstimateInUSD.quotient > 0n
                            ? trade.gasEstimateInUSD.toExact()
                            : null,
                    allowanceTarget: sellIdentity.isNative
                        ? null
                        : routerAddress,
                    transaction: {
                        to: routerAddress,
                        data: call.calldata,
                        value: BigInt(call.value).toString(),
                        gas: trade.gasEstimate.toString(),
                    },
                    platformFee,
                    route: trade.routes.map((route) => ({
                        protocols: route.pools.map((pool) =>
                            poolTypeName(pool.type),
                        ),
                        path: route.path.map((currency) =>
                            currency.isNative
                                ? NATIVE_TOKEN_ADDRESS
                                : currency.wrapped.address.toLowerCase(),
                        ),
                        percent: route.percent,
                    })),
                    permitData: null,
                    executable: true,
                    expiresAt: futureExpiry(1200),
                }
            } catch (error) {
                throw pancakeFailure(error, signal)
            }
        },

        async healthCheck(signal) {
            if (!pancake.rpcUrl) return false
            try {
                const client = createPancakeClient(
                    pancake.rpcUrl,
                    config.quotes.timeoutMs,
                    signal,
                )
                return (await client.getChainId()) === 56
            } catch {
                return false
            }
        },
    }
}
