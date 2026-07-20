import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    getApiConfig,
    readServerPort,
    validateStartupConfig,
} from '../src/config.js'
import { ProviderError, getSafeError } from '../src/lib/errors.js'
import {
    createQuoteSelector,
    selectBestQuote,
} from '../src/features/quotes/services/quote-selector.js'
import {
    normalizeTransaction,
    validateQuoteRequest,
} from '../src/features/quotes/schemas/quote-utils.js'
import {
    PANCAKE_ROUTING_CAPABILITIES,
    createPancakeCurrency,
    createPancakeSwapProvider,
    resolvePancakePlatformFee,
    withoutUnsafePancakeSdkWarnings,
} from '../src/features/quotes/providers/pancakeswap-provider.js'
import {
    ZERO_X_NATIVE_TOKEN_ADDRESS,
    normalizeProviderToken,
} from '../src/features/quotes/providers/provider-token.js'
import {
    createUniswapProvider,
    calculateUniswapEffectiveFee,
    validateUniswapIntegratorFee,
} from '../src/features/quotes/providers/uniswap-provider.js'
import {
    ZERO_X_ALLOWANCE_HOLDER_BY_CHAIN,
    createZeroXProvider,
} from '../src/features/quotes/providers/zero-x-provider.js'
import { NATIVE_TOKEN_ADDRESS } from '../src/lib/address.js'
import type {
    NormalizedQuote,
    QuoteProvider,
    QuoteProviderName,
} from '../src/features/quotes/types/types.js'

const tokenA = '0x0000000000000000000000000000000000000001'
const tokenB = '0x0000000000000000000000000000000000000002'
const tokenC = '0x0000000000000000000000000000000000000003'
const tokenD = '0x0000000000000000000000000000000000000004'
const xautToken = '0x21caef8a43163eea865baee23b9c2e327696a3bf'

const quoteRequest = {
    chainId: 56,
    sellToken: tokenA,
    buyToken: tokenB,
    mode: 'EXACT_INPUT',
    sellAmount: '100',
    buyAmount: null,
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
        mode: 'EXACT_INPUT',
        sellAmount: '100',
        buyAmount,
        minimumBuyAmount: (BigInt(buyAmount) - 10n).toString(),
        maximumSellAmount: '100',
        estimatedGas: '100000',
        estimatedGasUsd: null,
        allowanceTarget: tokenA,
        approval: provider === 'pancakeswap'
            ? {
                  mode: 'permit2-allowance',
                  contract: tokenA,
                  spender: tokenA,
                  token: tokenA,
                  requiredAmount: '100',
              }
            : null,
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
        supportsQuoteMode: (mode) => mode === 'EXACT_INPUT',
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
        process.env.ALCHEMY_API_KEY = 'test-alchemy-key'
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

    it('lets Pancake amount-too-small fall back to a valid 0x route', async () => {
        const select = createQuoteSelector([
            provider(
                'pancakeswap',
                new ProviderError({
                    code: 'PANCAKESWAP_AMOUNT_TOO_SMALL',
                    message: 'Amount is below the provider minimum.',
                    outcome: 'validation',
                }),
            ),
            provider('0x', quote('0x', '101')),
        ])

        const result = await select(quoteRequest)

        expect(result.selectedQuote.provider).toBe('0x')
        expect(result.providers).toEqual(expect.arrayContaining([
            expect.objectContaining({
                provider: 'pancakeswap',
                status: 'rejected',
                category: 'amount-below-provider-minimum',
            }),
        ]))
    })

    it('lets 0x no-liquidity fall back to a valid Pancake route', async () => {
        const select = createQuoteSelector([
            provider(
                '0x',
                new ProviderError({
                    code: 'ZEROX_NO_ROUTE',
                    message: '0x reported no available liquidity for this pair.',
                    outcome: 'no-route',
                }),
            ),
            provider('pancakeswap', quote('pancakeswap', '102')),
        ])

        const result = await select(quoteRequest)

        expect(result.selectedQuote.provider).toBe('pancakeswap')
        expect(result.providers).toEqual(expect.arrayContaining([
            expect.objectContaining({
                provider: '0x',
                status: 'rejected',
                category: 'no-liquidity',
            }),
        ]))
    })

    it('considers Pancake for XAUT to native BNB exact-input quotes', async () => {
        const pancake = createPancakeSwapProvider()

        expect(pancake.supportsChain(56)).toBe(true)
        expect(pancake.supportsQuoteMode('EXACT_INPUT')).toBe(true)
        expect(normalizeProviderToken({
            chainId: 56,
            address: xautToken,
            isNative: false,
        }).pancake).toEqual({ kind: 'erc20', address: xautToken })
        expect(normalizeProviderToken({
            chainId: 56,
            address: NATIVE_TOKEN_ADDRESS,
            isNative: true,
        }).pancake).toEqual({ kind: 'native' })
    })

    it('returns Pancake when 0x rejects the sell token legally', async () => {
        const pancakeQuote = {
            ...quote('pancakeswap', '102'),
            sellToken: xautToken,
            buyToken: NATIVE_TOKEN_ADDRESS,
            approval: {
                mode: 'permit2-allowance' as const,
                contract: tokenA,
                spender: tokenA,
                token: xautToken,
                requiredAmount: '100',
            },
        }
        const request = {
            ...quoteRequest,
            sellToken: xautToken,
            buyToken: NATIVE_TOKEN_ADDRESS,
        }
        const select = createQuoteSelector([
            provider('0x', new ProviderError({
                code: 'PROVIDER_VALIDATION_FAILED',
                message: 'The sell token is not authorized for trade due to legal restrictions',
                outcome: 'validation',
                upstreamStatus: 422,
            })),
            provider('pancakeswap', pancakeQuote),
        ])

        const result = await select(request)

        expect(result.selectedQuote.provider).toBe('pancakeswap')
        expect(result.approvalSchemaVersion).toBe(1)
        expect(JSON.parse(JSON.stringify(result)).selectedQuote.approval).toEqual({
            mode: 'permit2-allowance',
            contract: tokenA,
            spender: tokenA,
            token: xautToken,
            requiredAmount: '100',
        })
        expect(result.providers).toContainEqual(expect.objectContaining({
            provider: '0x',
            category: 'unsupported-token',
            retryable: false,
        }))
    })

    it('returns Pancake when Uniswap fee validation fails', async () => {
        const select = createQuoteSelector([
            provider('uniswap', new ProviderError({
                code: 'UNISWAP_INTEGRATOR_FEE_MISMATCH',
                message: 'Uniswap returned an inconsistent PistachioSwap fee.',
                outcome: 'validation',
            })),
            provider('pancakeswap', quote('pancakeswap', '102')),
        ])

        const result = await select(quoteRequest)

        expect(result.selectedQuote.provider).toBe('pancakeswap')
    })

    it('reports configured providers that are skipped as not eligible', async () => {
        const unsupported = provider('pancakeswap', quote('pancakeswap', '102'))
        unsupported.supportsChain = () => false
        const select = createQuoteSelector([
            provider('0x', quote('0x', '101')),
            unsupported,
        ])

        const result = await select(quoteRequest)

        expect(result.providers).toEqual([
            expect.objectContaining({ provider: '0x', category: 'valid-route' }),
            expect.objectContaining({
                provider: 'pancakeswap',
                status: 'skipped',
                category: 'skipped-not-eligible',
                error: 'CHAIN_NOT_SUPPORTED',
            }),
        ])
    })

    it('does not let one provider timeout erase another valid route', async () => {
        const select = createQuoteSelector([
            provider(
                'uniswap',
                new ProviderError({
                    code: 'UNISWAP_TIMEOUT',
                    message: 'Uniswap timed out.',
                    outcome: 'timeout',
                }),
            ),
            provider('0x', quote('0x', '101')),
        ])

        const result = await select(quoteRequest)

        expect(result.selectedQuote.provider).toBe('0x')
        expect(result.providers).toEqual(expect.arrayContaining([
            expect.objectContaining({
                provider: 'uniswap',
                category: 'timeout',
            }),
        ]))
    })

    it('rejects a malformed provider quote while keeping valid alternatives', async () => {
        const bad = quote('uniswap', '0')
        const select = createQuoteSelector([
            provider('uniswap', bad),
            provider('0x', quote('0x', '101')),
        ])

        const result = await select(quoteRequest)

        expect(result.selectedQuote.provider).toBe('0x')
        expect(result.providers).toEqual(expect.arrayContaining([
            expect.objectContaining({
                provider: 'uniswap',
                status: 'rejected',
                category: 'malformed-or-unsafe-quote',
            }),
        ]))
    })

    it('selects the best route after all eligible provider results settle', async () => {
        const select = createQuoteSelector([
            provider('uniswap', quote('uniswap', '100')),
            provider('0x', quote('0x', '103')),
            provider('pancakeswap', quote('pancakeswap', '101')),
        ])

        const result = await select(quoteRequest)

        expect(result.selectedQuote.provider).toBe('0x')
        expect(result.providers.filter((item) => item.status === 'fulfilled'))
            .toHaveLength(3)
    })

    it('does not select the first provider response automatically', async () => {
        const select = createQuoteSelector([
            provider('uniswap', quote('uniswap', '100')),
            provider('0x', quote('0x', '105')),
        ])

        const result = await select(quoteRequest)

        expect(result.providers[0]).toMatchObject({
            provider: 'uniswap',
            status: 'fulfilled',
        })
        expect(result.selectedQuote.provider).toBe('0x')
    })

    it('reports amount too small only when all providers return minimum rejections', async () => {
        const minimum = new ProviderError({
            code: 'PROVIDER_AMOUNT_TOO_SMALL',
            message: 'Amount is below the provider minimum.',
            outcome: 'validation',
        }) as ProviderError & { minimumInputAmountUsd: string }
        minimum.minimumInputAmountUsd = '1.25'
        const select = createQuoteSelector([
            provider('uniswap', minimum),
            provider(
                '0x',
                new ProviderError({
                    code: 'ZEROX_AMOUNT_TOO_SMALL',
                    message: 'Amount too small.',
                    outcome: 'validation',
                }),
            ),
        ])

        const safe = await select(quoteRequest).then(
            () => null,
            (error) => getSafeError(error),
        )

        expect(safe?.body.error.message).toBe(
            'This amount is too small for the available providers. Minimum available amount is approximately $1.25.',
        )
        expect(safe?.body.error.providers).toEqual(expect.arrayContaining([
            expect.objectContaining({
                category: 'amount-below-provider-minimum',
                minimumInputAmountUsd: '1.25',
            }),
        ]))
    })

    it('uses a generic no-route message for mixed provider failures', async () => {
        const select = createQuoteSelector([
            provider(
                'uniswap',
                new ProviderError({
                    code: 'UNISWAP_AMOUNT_TOO_SMALL',
                    message: 'Amount too small.',
                    outcome: 'validation',
                }),
            ),
            provider(
                '0x',
                new ProviderError({
                    code: 'ZEROX_NO_ROUTE',
                    message: '0x reported no available liquidity for this pair.',
                    outcome: 'no-route',
                }),
            ),
        ])

        const safe = await select(quoteRequest).then(
            () => null,
            (error) => getSafeError(error),
        )

        expect(safe?.body.error.message).toBe(
            'No executable route was found for this amount.',
        )
    })

    it('returns 503 with every provider diagnostic only after all eligible providers fail', async () => {
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
            provider(
                'pancakeswap',
                new ProviderError({
                    code: 'PANCAKESWAP_NO_ROUTE',
                    message: 'PancakeSwap Smart Router found no viable route.',
                    outcome: 'no-route',
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
                {
                    provider: 'pancakeswap',
                    outcome: 'no-route',
                    upstreamStatus: null,
                },
            ],
        })
        expect(safe?.body.error.providers).toHaveLength(3)
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

    it('converts native BNB to Pancake native currency with WBNB wrapping', async () => {
        const currency = await createPancakeCurrency(NATIVE_TOKEN_ADDRESS)

        expect(currency.isNative).toBe(true)
        expect(currency.wrapped.address.toLowerCase()).toBe(
            '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
        )
    })

    it('does not retry a deterministic 0x legal restriction', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            message: 'The sell token is not authorized for trade due to legal restrictions',
        }), {
            status: 422,
            headers: { 'content-type': 'application/json' },
        }))
        vi.stubGlobal('fetch', fetchMock)

        await expect(createZeroXProvider().getQuote(quoteRequest)).rejects.toMatchObject({
            code: 'PROVIDER_VALIDATION_FAILED',
            outcome: 'validation',
            upstreamStatus: 422,
            retryable: false,
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('sends current 0x AllowanceHolder headers and BSC request fields', async () => {
        const allowanceHolder = ZERO_X_ALLOWANCE_HOLDER_BY_CHAIN.get(56)!
        const fetchMock = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    buyAmount: '110',
                    minBuyAmount: '105',
                    allowanceTarget: allowanceHolder,
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
        expect(result.allowanceTarget).toBe(allowanceHolder)
        expect(result.transaction.to).toBe(tokenD)
    })

    it('rejects a 0x allowance target that is not the chain-authorized AllowanceHolder', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            buyAmount: '110',
            minBuyAmount: '105',
            allowanceTarget: tokenC,
            transaction: { to: tokenD, data: '0x1234', value: '0' },
            fees: {},
        }), { status: 200, headers: { 'content-type': 'application/json' } })))

        await expect(createZeroXProvider().getQuote(quoteRequest)).rejects.toMatchObject({
            code: 'ZEROX_ALLOWANCE_TARGET_INVALID',
        })
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
                        isTokenApprovalApplicable: false,
                        quote: {
                            quoteId: 'classic',
                            input: { amount: '100' },
                            output: { amount: '110' },
                            route: [{ type: 'v3-pool' }],
                        },
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
        expect(result.permitData).toBeNull()
    })

    it('encodes and validates the configured Uniswap integrator fee', async () => {
        process.env.PLATFORM_FEE_BPS = '45'
        process.env.FEE_COLLECTION_MODE = 'provider-affiliate'
        process.env.TREASURY_ADDRESS = tokenC
        const fetchMock = vi.fn(async (url, _options) => {
            if (String(url).includes('alchemy.com/prices')) {
                return new Response(JSON.stringify({ data: [{ address: tokenB, prices: [{ currency: 'usd', value: '1' }] }] }), { status: 200, headers: { 'content-type': 'application/json' } })
            }
            if (new URL(String(url)).pathname.endsWith('/quote')) {
                return new Response(
                    JSON.stringify({
                        routing: 'CLASSIC',
                        isTokenApprovalApplicable: false,
                        quote: {
                            quoteId: 'classic-with-fee',
                            input: { amount: '100' },
                            output: { amount: '1000000' },
                            aggregatedOutputs: [
                                {
                                    token: tokenB,
                                    amount: '995500',
                                    minAmount: '990000',
                                    recipient: tokenD,
                                    fee: 'NONE',
                                },
                                {
                                    token: tokenB,
                                    amount: '4500',
                                    minAmount: '4500',
                                    recipient: tokenC,
                                    bps: 45,
                                    fee: 'INTEGRATOR',
                                },
                            ],
                        },
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

        expect(quoteBody.integratorFees).toEqual([{
            bips: 45,
            recipient: tokenC,
        }])
        expect(result).toMatchObject({
            billingMode: 'provider-integrator',
            buyAmount: '995500',
            minimumBuyAmount: '990000',
            platformFee: {
                amount: '4500',
                token: tokenB,
                bps: 45,
            },
        })
    })

    it('rejects a rounded-up Uniswap integrator fee', () => {
        expect(() => validateUniswapIntegratorFee({
            rawQuote: {
                output: { amount: '1001' },
                aggregatedOutputs: [
                    {
                        token: tokenB,
                        amount: '996',
                        recipient: tokenD,
                        fee: 'NONE',
                    },
                    {
                        token: tokenB,
                        amount: '5',
                        recipient: tokenC,
                        bps: 45,
                        fee: 'INTEGRATOR',
                    },
                ],
            },
            buyToken: tokenB,
            sellAmount: '100',
            expected: { bps: 45, recipient: tokenC },
        })).toThrowError(expect.objectContaining({ code: 'UNISWAP_INTEGRATOR_FEE_MISMATCH' }))
    })

    it('rejects a genuinely incorrect Uniswap integrator fee', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        expect(() => validateUniswapIntegratorFee({
            rawQuote: {
                output: { amount: '1001' },
                aggregatedOutputs: [
                    {
                        token: tokenB,
                        amount: '991',
                        recipient: tokenD,
                        fee: 'NONE',
                    },
                    {
                        token: tokenB,
                        amount: '10',
                        recipient: tokenC,
                        bps: 45,
                        fee: 'INTEGRATOR',
                    },
                ],
            },
            buyToken: tokenB,
            sellAmount: '100',
            expected: { bps: 45, recipient: tokenC },
        })).toThrowError(expect.objectContaining({
            code: 'UNISWAP_INTEGRATOR_FEE_MISMATCH',
        }))
        expect(warn).toHaveBeenCalledWith(
            '[pistachio-api][uniswap-integrator-fee-validation]',
            expect.objectContaining({
                configuredFeeBps: 45,
                expectedFeeAmount: '4',
                actualFeeAmount: '10',
            }),
        )
        warn.mockRestore()
    })

    it('rejects a Uniswap quote that omits the configured fee output', async () => {
        process.env.PLATFORM_FEE_BPS = '45'
        process.env.FEE_COLLECTION_MODE = 'provider-affiliate'
        process.env.TREASURY_ADDRESS = tokenC
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (String(url).includes('alchemy.com/prices')) {
                return new Response(JSON.stringify({ data: [{ address: tokenB, prices: [{ currency: 'usd', value: '1' }] }] }), { status: 200, headers: { 'content-type': 'application/json' } })
            }
            if (new URL(String(url)).pathname.endsWith('/quote')) {
                return new Response(JSON.stringify({
                    routing: 'CLASSIC',
                    quote: {
                        quoteId: 'missing-fee',
                        input: { amount: '100' },
                        output: { amount: '110' },
                    },
                }), { status: 200, headers: { 'content-type': 'application/json' } })
            }
            return new Response(JSON.stringify({
                swap: { to: tokenD, data: '0x1234', value: '0' },
            }), { status: 200, headers: { 'content-type': 'application/json' } })
        }))

        await expect(createUniswapProvider().getQuote(quoteRequest)).rejects.toMatchObject({
            code: 'UNISWAP_INTEGRATOR_FEE_MISMATCH',
            outcome: 'validation',
        })
    })

    it('calculates minimum-chargeable and USD-capped Uniswap fees with integer arithmetic', () => {
        expect(calculateUniswapEffectiveFee({ grossOutputRaw: '41', configuredBps: 67, maximumBps: 500, maximumUsd: '5', buyTokenPriceUsd: '1', buyTokenDecimals: 0 })).toMatchObject({ effectiveBps: 244, feeAmountRaw: '1', adjustment: 'minimum-chargeable' })
        expect(calculateUniswapEffectiveFee({ grossOutputRaw: '100', configuredBps: 67, maximumBps: 500, maximumUsd: '5', buyTokenPriceUsd: '1', buyTokenDecimals: 0 })).toMatchObject({ effectiveBps: 100, feeAmountRaw: '1' })
        expect(calculateUniswapEffectiveFee({ grossOutputRaw: '150', configuredBps: 67, maximumBps: 500, maximumUsd: '5', buyTokenPriceUsd: '1', buyTokenDecimals: 0 })).toMatchObject({ effectiveBps: 67, feeAmountRaw: '1' })
        expect(() => calculateUniswapEffectiveFee({ grossOutputRaw: '19', configuredBps: 67, maximumBps: 500, maximumUsd: '5', buyTokenPriceUsd: '1', buyTokenDecimals: 0 })).toThrowError(expect.objectContaining({ code: 'UNISWAP_FEE_ROUTE_TOO_SMALL' }))
        expect(calculateUniswapEffectiveFee({ grossOutputRaw: '50000', configuredBps: 67, maximumBps: 500, maximumUsd: '5', buyTokenPriceUsd: '1', buyTokenDecimals: 0 })).toMatchObject({ effectiveBps: 1, feeAmountRaw: '5', adjustment: 'usd-cap' })
    })

    it('configures Pancake routing for V2, V3, stable, and multihop routes', () => {
        expect(PANCAKE_ROUTING_CAPABILITIES.poolTypes).toEqual(['V2', 'V3', 'STABLE'])
        expect(PANCAKE_ROUTING_CAPABILITIES.maxHops).toBeGreaterThan(1)
    })

    it('suppresses known Pancake SDK fallback console noise only inside the wrapper', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        await withoutUnsafePancakeSdkWarnings(async () => {
            console.warn('Call failed with error Error: Request timeout 3000ms', 'try next fallback')
            console.error('Call failed with error Error: No valid subgraph data provider', 'try next fallback')
            console.warn('Warning: 0x2941909551c7cefd9ebeb1c5200d8b614cf887ca is not checksummed.')
            console.warn('A real warning')
        })

        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledWith('A real warning')
        expect(error).not.toHaveBeenCalled()

        warn.mockRestore()
        error.mockRestore()
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

    it('accepts Uniswap as the configured affiliate-fee provider', () => {
        process.env.PLATFORM_FEE_BPS = '45'
        process.env.FEE_COLLECTION_MODE = 'provider-affiliate'
        process.env.TREASURY_ADDRESS = tokenA
        process.env.ZEROX_ENABLED = 'false'
        delete process.env.ZEROX_API_KEY
        process.env.UNISWAP_ENABLED = 'true'
        process.env.UNISWAP_API_KEY = 'test-uniswap-key'

        expect(() => validateStartupConfig(getApiConfig())).not.toThrow()
    })

    it('validates the configured server port', () => {
        expect(readServerPort('3001')).toBe(3001)
        expect(() => readServerPort('0')).toThrow('between 1 and 65535')
        expect(() => readServerPort('65536')).toThrow('between 1 and 65535')
        expect(() => readServerPort('3.5')).toThrow('between 1 and 65535')
    })
})
