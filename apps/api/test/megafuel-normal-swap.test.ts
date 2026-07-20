import type { Address } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import type { NormalizedQuote } from '../src/features/quotes/types/types.js'
import {
    validateExactSponsoredZeroXQuote,
} from '../src/gas-assist/prepaid/normal-swap.js'

const wallet = '0x1111111111111111111111111111111111111111' as Address
const sellToken = '0x2222222222222222222222222222222222222222' as Address
const buyToken = '0x3333333333333333333333333333333333333333' as Address
const allowanceHolder = '0x0000000000001ff3684f28c67538d4d072c22734'
const settler = '0x00000000000004533fe15556b1e086bb1a72ceae'

function quote(overrides: Partial<NormalizedQuote> = {}): NormalizedQuote {
    return {
        provider: '0x',
        billingMode: 'normal-provider-fee',
        quoteId: 'quote-1',
        chainId: 56,
        sellToken,
        buyToken,
        mode: 'EXACT_INPUT',
        sellAmount: '1000',
        buyAmount: '900',
        minimumBuyAmount: '850',
        maximumSellAmount: '1000',
        estimatedGas: '210000',
        estimatedGasUsd: null,
        allowanceTarget: allowanceHolder,
        transaction: {
            to: settler,
            data: '0x12345678aabbccdd',
            value: '0',
            gas: '210000',
        },
        platformFee: { amount: '0', token: null, bps: 0 },
        approval: null,
        route: [],
        permitData: null,
        executable: true,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ...overrides,
    }
}

describe('exact MegaFuel-sponsored 0x quote validation', () => {
    beforeEach(() => {
        process.env.MEGAFUEL_ZEROX_SAFE_APPROVAL_TARGETS_56 = allowanceHolder
        process.env.MEGAFUEL_ZEROX_SETTLER_ADDRESS_56 = settler
    })

    it('accepts an exact fee-free AllowanceHolder quote for the authenticated request', () => {
        const result = validateExactSponsoredZeroXQuote({
            quote: quote(),
            sellToken,
            buyToken,
            sellAmount: 1000n,
        })
        expect(result.transaction.to).toBe(settler)
        expect(result.allowanceTarget).toBe(allowanceHolder)
    })

    it.each([
        ['wrong sell amount', quote({ sellAmount: '1', maximumSellAmount: '1' })],
        ['provider fee', quote({ platformFee: { amount: '1', token: buyToken, bps: 1 } })],
        ['permit payload', quote({ permitData: { typedData: {} } })],
        ['wrong swap target', quote({ transaction: { to: wallet, data: '0x12345678aabbccdd', value: '0', gas: '210000' } })],
        ['nonzero native value', quote({ transaction: { to: settler, data: '0x12345678aabbccdd', value: '1', gas: '210000' } })],
    ])('rejects %s before creating a sponsored transaction intent', (_label, candidate) => {
        expect(() => validateExactSponsoredZeroXQuote({
            quote: candidate,
            sellToken,
            buyToken,
            sellAmount: 1000n,
        })).toThrow()
    })
})
