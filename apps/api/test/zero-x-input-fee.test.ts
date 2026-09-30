import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    ZERO_X_ALLOWANCE_HOLDER_BY_CHAIN,
    createZeroXProvider,
} from '../src/features/quotes/providers/zero-x-provider.js'

const sellToken = '0x1111111111111111111111111111111111111111'
const buyToken = '0x2222222222222222222222222222222222222222'
const wallet = '0x3333333333333333333333333333333333333333'
const feeExemptWallet = '0x2941909551C7ceFd9EbEB1C5200D8B614CF887Ca'
const treasury = '0x4444444444444444444444444444444444444444'
const settler = '0x5555555555555555555555555555555555555555'
const allowanceHolder = ZERO_X_ALLOWANCE_HOLDER_BY_CHAIN.get(56)!

const request = {
    chainId: 56,
    sellToken,
    buyToken,
    mode: 'EXACT_INPUT' as const,
    sellAmount: '1000000000000000000',
    buyAmount: null,
    sellTokenDecimals: 18,
    buyTokenDecimals: 18,
    takerAddress: wallet,
    slippageBps: 50,
}

function responseWithFee(amount = '6700000000000000', token = sellToken) {
    return {
        liquidityAvailable: true,
        zid: 'zero-x-input-fee',
        buyAmount: '990000000000000000',
        minBuyAmount: '980000000000000000',
        gas: '210000',
        issues: {
            allowance: { spender: allowanceHolder },
        },
        fees: {
            integratorFee: { amount, token },
        },
        transaction: {
            to: settler,
            data: '0x1234',
            value: '0',
            gas: '210000',
        },
        route: { fills: [] },
    }
}

describe.sequential('0x input-token platform fee', () => {
    const previousEnv = { ...process.env }

    beforeEach(() => {
        process.env = { ...previousEnv }
        process.env.ZEROX_ENABLED = 'true'
        process.env.ZEROX_API_KEY = 'test-zero-x-key'
        process.env.PLATFORM_FEE_BPS = '67'
        process.env.FEE_COLLECTION_MODE = 'provider-affiliate'
        process.env.FEE_TOKEN_MODE = 'sellToken'
        process.env.TREASURY_ADDRESS = treasury
    })

    afterEach(() => {
        process.env = { ...previousEnv }
        vi.unstubAllGlobals()
    })

    it('requests and validates the fee in the sell token', async () => {
        const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
            const url = new URL(String(input))
            expect(url.searchParams.get('swapFeeRecipient')).toBe(treasury)
            expect(url.searchParams.get('swapFeeBps')).toBe('67')
            expect(url.searchParams.get('swapFeeToken')).toBe(sellToken)
            return new Response(JSON.stringify(responseWithFee()), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        })
        vi.stubGlobal('fetch', fetchMock)

        const quote = await createZeroXProvider().getQuote(request)

        expect(quote.platformFee).toEqual({
            amount: '6700000000000000',
            token: sellToken,
            bps: 67,
        })
        expect(quote.billingMode).toBe('provider-integrator')
        expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('hardcodes zero platform fee for the normal-quote exempt wallet', async () => {
        const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
            const url = new URL(String(input))
            expect(url.searchParams.get('swapFeeRecipient')).toBeNull()
            expect(url.searchParams.get('swapFeeBps')).toBeNull()
            expect(url.searchParams.get('swapFeeToken')).toBeNull()
            return new Response(JSON.stringify({
                ...responseWithFee(),
                fees: {},
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        })
        vi.stubGlobal('fetch', fetchMock)

        const quote = await createZeroXProvider().getQuote({
            ...request,
            takerAddress: feeExemptWallet,
        })

        expect(quote.platformFee).toEqual({
            amount: '0',
            token: null,
            bps: 0,
        })
        expect(quote.billingMode).toBe('normal-provider-fee')
        expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('rejects a paid route when 0x omits the required fee', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            ...responseWithFee(),
            fees: {},
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })))

        await expect(createZeroXProvider().getQuote(request)).rejects.toMatchObject({
            code: 'ZEROX_INTEGRATOR_FEE_MISMATCH',
        })
    })

    it('rejects a paid route when 0x returns the fee in the output token', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(
            responseWithFee('6700000000000000', buyToken),
        ), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })))

        await expect(createZeroXProvider().getQuote(request)).rejects.toMatchObject({
            code: 'ZEROX_INTEGRATOR_FEE_MISMATCH',
        })
    })
})
