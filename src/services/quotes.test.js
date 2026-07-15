import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    createQuoteRequestBody,
    fetchSwapQuote,
    isCurrentQuoteResponse,
} from './quotes.js'

const ADDRESS =
    '0x0000000000000000000000000000000000000001'

describe('frontend quote requests', () => {
    afterEach(() => {
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

    it('rejects wrong-chain and invalid-address quote requests', () => {
        expect(() =>
            createQuoteRequestBody({
                chainId: 1,
                takerAddress: ADDRESS,
            }),
        ).toThrow('BNB Chain')

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
})
