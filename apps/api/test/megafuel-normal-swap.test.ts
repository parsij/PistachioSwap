import type { Address } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NormalizedQuote, QuoteProvider } from '../src/features/quotes/types/types.js'
import {
    getExactSponsoredQuote,
    validateExactSponsoredQuote,
} from '../src/gas-assist/prepaid/normal-swap.js'

const wallet = '0x1111111111111111111111111111111111111111' as Address
const sellToken = '0x2222222222222222222222222222222222222222' as Address
const buyToken = '0x3333333333333333333333333333333333333333' as Address
const allowanceHolder = '0x0000000000001ff3684f28c67538d4d072c22734'
const settler = '0x00000000000004533fe15556b1e086bb1a72ceae'
const uniswapProxy = '0x0000000085e102724e78ecd2f45dc9ca239affad'

function zeroXQuote(overrides: Partial<NormalizedQuote> = {}): NormalizedQuote {
    return {
        provider: '0x', billingMode: 'normal-provider-fee', quoteId: 'zero-x-1', chainId: 56,
        sellToken, buyToken, mode: 'EXACT_INPUT', sellAmount: '1000', buyAmount: '900',
        minimumBuyAmount: '850', maximumSellAmount: '1000', estimatedGas: '210000', estimatedGasUsd: null,
        allowanceTarget: allowanceHolder,
        transaction: { to: settler, data: '0x12345678aabbccdd', value: '0', gas: '210000' },
        platformFee: { amount: '0', token: null, bps: 0 }, approval: null, route: [], permitData: null,
        executable: true, expiresAt: new Date(Date.now() + 60_000).toISOString(), ...overrides,
    }
}

function uniswapQuote(overrides: Partial<NormalizedQuote> = {}): NormalizedQuote {
    return {
        provider: 'uniswap', billingMode: 'normal-provider-fee', quoteId: 'uniswap-1', chainId: 56,
        sellToken, buyToken, mode: 'EXACT_INPUT', sellAmount: '1000', buyAmount: '910',
        minimumBuyAmount: '860', maximumSellAmount: '1000', estimatedGas: '240000', estimatedGasUsd: null,
        allowanceTarget: uniswapProxy,
        transaction: { to: uniswapProxy, data: '0x2894adf9aabbccdd', value: '0', gas: '240000' },
        platformFee: { amount: '0', token: null, bps: 0 },
        approval: { mode: 'erc20', contract: uniswapProxy, spender: uniswapProxy, token: sellToken, requiredAmount: '1000' },
        route: [], permitData: null, executable: true, expiresAt: new Date(Date.now() + 60_000).toISOString(), ...overrides,
    }
}

function provider(name: QuoteProvider['name'], getQuote: QuoteProvider['getQuote']): QuoteProvider {
    return { name, supportsChain: () => true, supportsQuoteMode: () => true, getQuote }
}

describe('exact MegaFuel-sponsored quote validation', () => {
    beforeEach(() => {
        process.env.MEGAFUEL_ZEROX_SAFE_APPROVAL_TARGETS_56 = allowanceHolder
        process.env.MEGAFUEL_ZEROX_SETTLER_ADDRESS_56 = settler
    })

    it('accepts an exact fee-free Uniswap proxy quote', () => {
        const result = validateExactSponsoredQuote({ quote: uniswapQuote(), sellToken, buyToken, sellAmount: 1000n })
        expect(result.provider).toBe('uniswap')
        expect(result.transaction.to).toBe(uniswapProxy)
        expect(result.allowanceTarget).toBe(uniswapProxy)
    })

    it('accepts an exact fee-free 0x AllowanceHolder quote', () => {
        const result = validateExactSponsoredQuote({ quote: zeroXQuote(), sellToken, buyToken, sellAmount: 1000n })
        expect(result.provider).toBe('0x')
        expect(result.transaction.to).toBe(settler)
    })

    it('prefers Uniswap and never calls 0x when Uniswap returns a safe route', async () => {
        const uniswap = provider('uniswap', vi.fn().mockResolvedValue(uniswapQuote()))
        const zeroX = provider('0x', vi.fn().mockRejectedValue(Object.assign(new Error('legal restriction'), { code: 'SELL_TOKEN_NOT_AUTHORIZED_FOR_TRADE' })))
        const result = await getExactSponsoredQuote({
            wallet, sellToken, buyToken, sellAmount: 1000n, sellTokenDecimals: 6,
            buyTokenDecimals: 18, slippageBps: 50, providers: [uniswap, zeroX],
        })
        expect(result.provider).toBe('uniswap')
        expect(uniswap.getQuote).toHaveBeenCalledOnce()
        expect(zeroX.getQuote).not.toHaveBeenCalled()
    })

    it('falls back to 0x only when Uniswap cannot provide a route', async () => {
        const uniswap = provider('uniswap', vi.fn().mockRejectedValue(Object.assign(new Error('no route'), { code: 'UNISWAP_NO_ROUTE' })))
        const zeroX = provider('0x', vi.fn().mockResolvedValue(zeroXQuote()))
        const result = await getExactSponsoredQuote({
            wallet, sellToken, buyToken, sellAmount: 1000n, sellTokenDecimals: 6,
            buyTokenDecimals: 18, slippageBps: 50, providers: [uniswap, zeroX],
        })
        expect(result.provider).toBe('0x')
        expect(zeroX.getQuote).toHaveBeenCalledOnce()
    })

    it.each([
        ['provider fee', uniswapQuote({ platformFee: { amount: '1', token: buyToken, bps: 1 } })],
        ['permit payload', uniswapQuote({ permitData: { typedData: {} } })],
        ['wrong Uniswap proxy', uniswapQuote({ allowanceTarget: wallet, transaction: { to: wallet, data: '0x2894adf9aabbccdd', value: '0', gas: '240000' } })],
        ['nonzero native value', uniswapQuote({ transaction: { to: uniswapProxy, data: '0x2894adf9aabbccdd', value: '1', gas: '240000' } })],
    ])('rejects %s before creating a sponsored transaction intent', (_label, candidate) => {
        expect(() => validateExactSponsoredQuote({ quote: candidate, sellToken, buyToken, sellAmount: 1000n })).toThrow()
    })
})
