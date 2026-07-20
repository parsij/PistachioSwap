import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { getAddress } from 'viem'

import {
    createQuoteRequestBody,
    clearQuoteCacheForTest,
    fetchSwapQuote,
    isCurrentQuoteResponse,
    normalizeQuoteResponse,
    quoteCacheSizeForTest,
} from './quotes.js'

const ADDRESS =
    '0x0000000000000000000000000000000000000001'
const TOKEN = '0x0000000000000000000000000000000000000002'
const ROUTER = '0x0000000000000000000000000000000000000003'
const PERMIT2 = '0x0000000000000000000000000000000000000004'

function pancakeResponse(overrides = {}) {
    return {
        approvalSchemaVersion: 1,
        selectedQuote: {
            provider: 'pancakeswap',
            chainId: 56,
            sellToken: TOKEN,
            allowanceTarget: PERMIT2,
            expiresAt: '2999-01-01T00:00:00.000Z',
            transaction: { to: ROUTER, data: '0x1234', value: '0' },
            approval: {
                mode: 'permit2-allowance',
                contract: PERMIT2,
                spender: ROUTER,
                token: TOKEN,
                requiredAmount: '100',
            },
            ...overrides,
        },
    }
}

describe('frontend quote requests', () => {
    afterEach(() => {
        clearQuoteCacheForTest()
        vi.unstubAllGlobals()
    })

    it('passes the current connected address as takerAddress', () => {
        expect(
            createQuoteRequestBody({
                chainId: 56,
                sellToken: ADDRESS,
                buyToken:
                    '0x0000000000000000000000000000000000000002',
                sellAmount: '10',
                sellTokenDecimals: 18,
                buyTokenDecimals: 18,
                takerAddress: ADDRESS,
            }),
        ).toMatchObject({
            chainId: 56,
            takerAddress: ADDRESS,
        })
    })

    it('normalizes quote request addresses to checksum form', () => {
        const takerAddress = '0x2941909551c7cefd9ebeb1c5200d8b614cf887ca'
        const sellToken = '0x55d398326f99059ff775485246999027b3197955'
        const buyToken = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'

        expect(createQuoteRequestBody({
            chainId: 56,
            sellToken,
            buyToken,
            sellAmount: '10',
            sellTokenDecimals: 18,
            buyTokenDecimals: 18,
            takerAddress,
        })).toMatchObject({
            takerAddress: getAddress(takerAddress),
            sellToken: getAddress(sellToken),
            buyToken: getAddress(buyToken),
        })
    })

    it('preserves canonical Pancake approval metadata during normalization', () => {
        const normalized = normalizeQuoteResponse(pancakeResponse())
        expect(normalized.selectedQuote.approval).toEqual({
            mode: 'permit2-allowance',
            contract: getAddress(PERMIT2),
            spender: getAddress(ROUTER),
            token: getAddress(TOKEN),
            requiredAmount: '100',
        })
    })

    it('preserves canonical Pancake approval metadata in the quote cache', async () => {
        const fetchMock = vi.fn(async () => new Response(
            JSON.stringify(pancakeResponse()),
            { status: 200, headers: { 'content-type': 'application/json' } },
        ))
        vi.stubGlobal('fetch', fetchMock)
        const request = { takerAddress: ADDRESS, sellAmount: '100' }

        const first = await fetchSwapQuote({ endpoint: '/v1/quote', request })
        const cached = await fetchSwapQuote({ endpoint: '/v1/quote', request })

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(cached.selectedQuote.approval).toEqual(first.selectedQuote.approval)
        expect(cached.selectedQuote.approval.mode).toBe('permit2-allowance')
    })

    it('rejects and does not cache a legacy Pancake approval response', async () => {
        const legacy = pancakeResponse()
        delete legacy.approvalSchemaVersion
        legacy.selectedQuote.approval = {
            type: 'permit2-allowance',
            permit2Address: PERMIT2,
            spender: ROUTER,
            token: TOKEN,
            amount: '100',
        }
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
            JSON.stringify(legacy),
            { status: 200, headers: { 'content-type': 'application/json' } },
        )))

        await expect(fetchSwapQuote({
            endpoint: '/v1/quote',
            request: { takerAddress: ADDRESS, sellAmount: '100' },
        })).rejects.toThrow('PancakeSwap approval information is incomplete')
        expect(quoteCacheSizeForTest()).toBe(0)
    })

    it('rejects unsupported-chain and invalid-address quote requests', () => {
        expect(() =>
            createQuoteRequestBody({
                chainId: 999_999,
                takerAddress: ADDRESS,
            }),
        ).toThrow('enabled EVM chain')

        expect(() =>
            createQuoteRequestBody({
                chainId: 56,
                takerAddress: 'invalid',
            }),
        ).toThrow('connected wallet address')
    })

    it('rejects invalid slippage instead of silently coercing it', () => {
        expect(() => createQuoteRequestBody({
            chainId: 56,
            sellToken: ADDRESS,
            buyToken: '0x0000000000000000000000000000000000000002',
            sellAmount: '1',
            sellTokenDecimals: 18,
            buyTokenDecimals: 18,
            takerAddress: ADDRESS,
            slippageBps: 0,
        })).toThrow('Slippage')
    })

    it('accepts custom slippage through 100 percent', () => {
        const base = {
            chainId: 56,
            sellToken: ADDRESS,
            buyToken: '0x0000000000000000000000000000000000000002',
            sellAmount: '1',
            sellTokenDecimals: 18,
            buyTokenDecimals: 18,
            takerAddress: ADDRESS,
        }
        expect(createQuoteRequestBody({ ...base, slippageBps: 6_000 }).slippageBps)
            .toBe(6_000)
        expect(createQuoteRequestBody({ ...base, slippageBps: 10_000 }).slippageBps)
            .toBe(10_000)
        expect(() => createQuoteRequestBody({ ...base, slippageBps: 10_001 }))
            .toThrow('Slippage')
    })

    it('forwards aborts so stale account quotes stop', async () => {
        const fetchMock = vi.fn((url, options) =>
            new Promise((resolve, reject) => {
                options.signal.addEventListener(
                    'abort',
                    () => reject(
                        new DOMException(
                            'Aborted',
                            'AbortError',
                        ),
                    ),
                    { once: true },
                )
            }),
        )
        vi.stubGlobal('fetch', fetchMock)

        const controller = new AbortController()
        const request = fetchSwapQuote({
            endpoint: 'http://localhost:3001/v1/quote',
            request: { takerAddress: ADDRESS },
            signal: controller.signal,
        })

        controller.abort()

        await expect(request).rejects.toMatchObject({
            name: 'AbortError',
        })
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
        expect(isCurrentQuoteResponse(controller.signal)).toBe(false)
    })

    it('bounds the per-tab quote cache across changing amount keys', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            selectedQuote: { expiresAt: '2999-01-01T00:00:00.000Z' },
        }), { status: 200, headers: { 'content-type': 'application/json' } })))

        for (let index = 0; index < 105; index += 1) {
            await fetchSwapQuote({
                endpoint: '/v1/quote',
                request: { takerAddress: ADDRESS, sellAmount: String(index + 1) },
            })
        }

        expect(quoteCacheSizeForTest()).toBe(100)
    })

    it('uses the aggregate quote error instead of the first provider message', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            error: {
                code: 'NO_ROUTE_AVAILABLE',
                message: 'No executable route was found for this amount.',
                providers: [
                    {
                        provider: 'pancakeswap',
                        category: 'amount-below-provider-minimum',
                        message: 'Amount too small.',
                    },
                    {
                        provider: '0x',
                        category: 'no-liquidity',
                        message: 'No liquidity.',
                    },
                ],
            },
        }), { status: 503, headers: { 'content-type': 'application/json' } })))

        await expect(fetchSwapQuote({
            endpoint: '/v1/quote',
            request: { takerAddress: ADDRESS, sellAmount: '1' },
        })).rejects.toMatchObject({
            message: 'No executable route was found for this amount.',
            diagnostic: expect.objectContaining({
                providers: expect.arrayContaining([
                    expect.objectContaining({
                        category: 'amount-below-provider-minimum',
                    }),
                ]),
            }),
        })
    })
})
