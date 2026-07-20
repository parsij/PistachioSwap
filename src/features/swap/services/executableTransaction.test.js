import { describe, expect, it } from 'vitest'

import { getValidatedExecutableTransaction } from './executableTransaction.js'

const ACCOUNT = '0x0000000000000000000000000000000000000001'
const SELL = '0x0000000000000000000000000000000000000002'
const BUY = '0x0000000000000000000000000000000000000003'
const TARGET = '0x0000000000000000000000000000000000000004'

function quote(overrides = {}) {
    return { selectedQuote: { chainId: 56, sellToken: SELL, buyToken: BUY, takerAddress: ACCOUNT, expiresAt: '2999-01-01T00:00:00.000Z', transaction: { to: TARGET, data: '0x1234', value: '7', gas: '21000' }, ...overrides } }
}

describe('validated executable transaction', () => {
    it('returns the exact normalized request bound to chain, tokens, and account', () => {
        expect(getValidatedExecutableTransaction({ quoteResponse: quote(), expectedChainId: 56, expectedSellToken: SELL, expectedBuyToken: BUY, expectedAccount: ACCOUNT })).toEqual({ to: TARGET, data: '0x1234', value: 7n, gas: 21000n, chainId: 56 })
    })

    it.each([
        ['target', { transaction: { to: null, data: '0x1234', value: '0' } }, 'destination address'],
        ['calldata', { transaction: { to: TARGET, data: '0x', value: '0' } }, 'transaction data'],
        ['chain', { chainId: 1 }, 'selected chain and tokens'],
        ['account', { takerAddress: TARGET }, 'connected wallet'],
        ['expiry', { expiresAt: '2020-01-01T00:00:00.000Z' }, 'quote expired'],
    ])('rejects an invalid %s', (_label, override, message) => {
        expect(() => getValidatedExecutableTransaction({ quoteResponse: quote(override), expectedChainId: 56, expectedSellToken: SELL, expectedBuyToken: BUY, expectedAccount: ACCOUNT })).toThrow(message)
    })
})
