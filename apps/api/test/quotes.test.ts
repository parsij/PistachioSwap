import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    getApiConfig,
    validateStartupConfig,
} from '../src/config.js'
import { ProviderError, getSafeError } from '../src/lib/errors.js'
import {
    createQuoteSelector,
    selectBestQuote,
} from '../src/providers/quotes/quote-selector.js'
import {
    normalizeTransaction,
    validateQuoteRequest,
} from '../src/providers/quotes/quote-utils.js'
import {
    PANCAKE_ROUTING_CAPABILITIES,
    resolvePancakePlatformFee,
} from '../src/providers/quotes/pancakeswap-provider.js'
import {
    ZERO_X_NATIVE_TOKEN_ADDRESS,
    normalizeProviderToken,
} from '../src/providers/quotes/provider-token.js'
import { createUniswapProvider } from '../src/providers/quotes/uniswap-provider.js'
import { createZeroXProvider } from '../src/providers/quotes/zero-x-provider.js'
import { NATIVE_TOKEN_ADDRESS } from '../src/lib/address.js'
import type {
    NormalizedQuote,
    QuoteProvider,
    QuoteProviderName,
} from '../src/providers/quotes/types.js'

const tokenA = '0x0000000000000000000000000000000000000001'
const tokenB = '0x0000000000000000000000000000000000000002'
const tokenC = '0x0000000000000000000000000000000000000003'
const tokenD = '0x0000000000000000000000000000000000000004'

const quoteRequest = {
    chainId: 56,
    sellToken: tokenA,
    buyToken: tokenB,
    sellAmount: '100',
    sellTokenDecimals: 18,
    buyTokenDecimals: 18,
    takerAddress: tokenD,
    slippageBps: 50,
} as const

function quote(
    provider: QuoteProviderName,
    buyAmount: string,
    feeAmount = '0',
): NormalizedQuote {
    return {
        provider,
        quoteId: provider,
        chainId: 56,
        sellToken: tokenA,
        buyToken: tokenB,
        sellAmount: '100',
        buyAmount,
        minimumBuyAmount: '90',
        estimatedGas: '100000',
        estimatedGasUsd: null,
        allowanceTarget: tokenA,
        transaction: {
            to: tokenA,
            data: '0x1234',
            value: '0',
        },
        platformFee: {
            amount: feeAmount,
            token: feeAmount === '0' ? null : tokenB,
            bps: feeAmount === '0' ? 0 : 100,
        },
        route: [],
        permitData: null,
        executable: true,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
    }
}

function provider(
    name: QuoteProviderName,
    result: NormalizedQuote | Error,
): QuoteProvider {
    return {
        name,
        supportsChain: (chainId) => chainId === 56,
        getQuote: async () => {
            if (result instanceof Error) throw result
            return result
        },
        healthCheck: async () => true,
    }
}

describe.sequential('quote normalization and selection', () => {
    const previousEnv = { ...process.env }

    beforeEach(() => {
        process.env.QUOTE_PROVIDER_MODE = 'best'
        process.env.QUOTE_PROVIDERS = 'uniswap,0x,pancakeswap'
        process.env.UNISWAP_ENABLED = 'true'
        process.env.ZEROX_ENABLED = 'true'
        process.env.PANCAKESWAP_ENABLED = 'true'
        process.env.PLATFORM_FEE_BPS = '0'
        process.env.FEE_COLLECTION_MODE = 'none'
        process.env.ZEROX_API_KEY = 'test-zero-x-key'
        process.env.UNISWAP_API_KEY = 'test-uniswap-key'
    })

    afterEach(() => {
        process.env = { ...previousEnv }
        vi.unstubAllGlobals()
    })

    it('normalizes provider transaction hex quantities', () => {
        expect(
            normalizeTransaction({
                to: tokenA,
                data: '0x1234',
                value: '0x10',
                gas: '0x5208',
            }),
        ).toEqual({
            to: tokenA,
            data: '0x1234',
            value: '16',
            gas: '21000',
        })
    })

    it('accepts quote slippage through 100 percent', () => {
        expect(validateQuoteRequest({
            ...quoteRequest,
            slippageBps: 6_000,
        }).slippageBps).toBe(6_000)
        expect(validateQuoteRequest({
            ...quoteRequest,
            slippageBps: 10_000,
        }).slippageBps).toBe(10_000)
        expect(() => validateQuoteRequest({
            ...quoteRequest,
            slippageBps: 10_001,
        })).toThrow('valid slippage')
    })

    it('selects the highest executable output with sell-side fee metadata', () => {
        const zeroXQuote = quote('0x', '105', '10')
        zeroXQuote.platformFee.token = tokenA

        expect(
            selectBestQuote([
                quote('uniswap', '100'),
                zeroXQuote,
                quote('pancakeswap', '101'),
            ]).provider,
        ).toBe('0x')
    })

    it('keeps successful quotes when another provider fails', async () => {
        const select = createQuoteSelector([
            provider(
                'uniswap',
                new ProviderError({
                    code: 'OFFLINE',
                    message: 'offline',
                }),
            ),
            provider('0x', quote('0x', '101')),
        ])
        const result = await select({
            chainId: 56,
            sellToken: tokenA,
            buyToken: tokenB,
            sellAmount: '100',
            sellTokenDecimals: 18,
            buyTokenDecimals: 18,
            takerAddress: tokenA,
            slippageBps: 50,
        })
        expect(result.selectedQuote.provider).toBe('0x')
        expect(result.providers).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    provider: 'uniswap',
                    status: 'rejected',
                    error: 'OFFLINE',
                }),
            ]),
        )
    })

    it('returns safe per-provider diagnostics only after every provider fails', async () => {
        const select = createQuoteSelector([
            provider(
                'uniswap',
                new ProviderError({
                    code: 'UNISWAP_AUTH',
                    message: 'Invalid API key.',
                    outcome: 'authentication',
                    upstreamStatus: 401,
                }),
            ),
            provider(
                '0x',
                new ProviderError({
                    code: 'ZEROX_VALIDATION',
                    message: 'sellToken: invalid address',
                    outcome: 'validation',
                    upstreamStatus: 400,
                }),
            ),
        ])

        const safe = await select(quoteRequest).then(
            () => null,
            (error) => getSafeError(error),
        )
        expect(safe?.statusCode).toBe(503)
        expect(safe?.body.error).toMatchObject({
            code: 'NO_ROUTE_AVAILABLE',
            providers: [
                {
                    provider: 'uniswap',
                    outcome: 'authentication',
                    upstreamStatus: 401,
                },
                {
                    provider: '0x',
                    outcome: 'validation',
                    upstreamStatus: 400,
                },
            ],
        })
        expect(JSON.stringify(safe)).not.toContain('test-zero-x-key')
    })

    it('maps native BNB for each provider without conflating WBNB', () => {
        const native = normalizeProviderToken({
            chainId: 56,
            address: NATIVE_TOKEN_ADDRESS,
            isNative: true,
        })
        const wrapped = normalizeProviderToken({
            chainId: 56,
            address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
            isNative: false,
        })
        expect(native.zeroX).toBe(ZERO_X_NATIVE_TOKEN_ADDRESS)
        expect(native.uniswap).toBe(NATIVE_TOKEN_ADDRESS)
        expect(native.pancake).toEqual({ kind: 'native' })
        expect(wrapped.zeroX).toBe(wrapped.internal)
        expect(wrapped.internal).not.toBe(native.internal)
    })

    it('sends current 0x AllowanceHolder headers and BSC request fields', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    buyAmount: '110',
                    minBuyAmount: '105',
                    allowanceTarget: tokenC,
                    transaction: { to: tokenD, data: '0x1234', value: '0' },
                    route: { fills: [{ source: 'PancakeSwap_V3' }] },
                    fees: {},
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            ),
        )
        vi.stubGlobal('fetch', fetchMock)

        const result = await createZeroXProvider().getQuote(quoteRequest)
        const [url, options] = fetchMock.mock.calls[0]
        expect(new URL(String(url)).pathname).toBe('/swap/allowance-holder/quote')
        expect(new URL(String(url)).searchParams.get('chainId')).toBe('56')
        expect(new URL(String(url)).searchParams.get('sellAmount')).toBe('100')
        expect(options.headers).toMatchObject({
            '0x-api-key': 'test-zero-x-key',
            '0x-version': 'v2',
            accept: 'application/json',
        })
        expect(result.allowanceTarget).toBe(tokenC)
        expect(result.transaction.to).toBe(tokenD)
    })

    it('keeps 0x field validation visible and sanitized', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                new Response(
                    JSON.stringify({
                        message: 'The input is invalid',
                        data: {
                            details: [
                                { field: 'sellToken', reason: 'Invalid ethereum address' },
                            ],
                        },
                    }),
                    { status: 400, headers: { 'content-type': 'application/json' } },
                ),
            ),
        )

        await expect(createZeroXProvider().getQuote(quoteRequest)).rejects.toMatchObject({
            outcome: 'validation',
            upstreamStatus: 400,
            message: expect.stringContaining('sellToken'),
        })
    })

    it('classifies an explicit 0x liquidity miss as no-route', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                new Response(
                    JSON.stringify({ liquidityAvailable: false }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ),
            ),
        )

        await expect(createZeroXProvider().getQuote(quoteRequest)).rejects.toMatchObject({
            code: 'ZEROX_NO_ROUTE',
            outcome: 'no-route',
        })
    })

    it('allows Uniswap CLASSIC routes without UniswapX-only protocols', async () => {
        const fetchMock = vi.fn(async (url, _options) => {
            if (new URL(String(url)).pathname.endsWith('/quote')) {
                return new Response(
                    JSON.stringify({
                        routing: 'CLASSIC',
                        quote: {
                            quoteId: 'classic',
                            input: { amount: '100' },
                            output: { amount: '110' },
                            route: [{ type: 'v3-pool' }],
                        },
                        permitData: { values: { spender: tokenC } },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                )
            }
            return new Response(
                JSON.stringify({
                    swap: { to: tokenD, data: '0x1234', value: '0' },
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            )
        })
        vi.stubGlobal('fetch', fetchMock)

        const result = await createUniswapProvider().getQuote(quoteRequest)
        const quoteBody = JSON.parse(fetchMock.mock.calls[0][1].body)
        expect(quoteBody).toMatchObject({
            tokenInChainId: 56,
            tokenOutChainId: 56,
            type: 'EXACT_INPUT',
            amount: '100',
            swapper: tokenD,
        })
        expect(quoteBody.protocols).toBeUndefined()
        expect(result.route).toEqual([{ type: 'v3-pool' }])
        expect(result.permitData).toEqual({ values: { spender: tokenC } })
    })

    it('configures Pancake routing for V2, V3, stable, and multihop routes', () => {
        expect(PANCAKE_ROUTING_CAPABILITIES.poolTypes).toEqual(['V2', 'V3', 'STABLE'])
        expect(PANCAKE_ROUTING_CAPABILITIES.maxHops).toBeGreaterThan(1)
    })

    it('validates fee modes and rejects Pancake executor claims', () => {
        process.env.PLATFORM_FEE_BPS = '45'
        process.env.FEE_COLLECTION_MODE = 'executor-contract'
        process.env.TREASURY_ADDRESS = tokenA
        delete process.env.FEE_EXECUTOR_ADDRESS_56

        expect(() => validateStartupConfig(getApiConfig())).toThrow(
            'FEE_EXECUTOR_ADDRESS_56',
        )

        process.env.FEE_EXECUTOR_ADDRESS_56 = tokenB
        expect(() => resolvePancakePlatformFee()).toThrow(
            'fee collection is not implemented',
        )
    })
})
