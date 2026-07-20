import { describe, expect, it } from 'vitest'

import { RefreshedQuoteValidationError, validateRefreshedQuote } from './refreshedQuoteValidation.js'

const ACCOUNT = '0x0000000000000000000000000000000000000001'
const SELL = '0x0000000000000000000000000000000000000002'
const BUY = '0x0000000000000000000000000000000000000003'
const PERMIT2 = '0x0000000000000000000000000000000000000004'
const ROUTER = '0x0000000000000000000000000000000000000005'
const request = { chainId: 56, sellToken: SELL, buyToken: BUY, takerAddress: ACCOUNT, mode: 'EXACT_INPUT', sellAmount: '100', buyAmount: null, slippageBps: 50 }
const snapshot = { requestKey: 'request-key', inputKey: 'input-key', slippageBps: 50, request }

function quote(overrides = {}) {
    return { approvalSchemaVersion: 1, selectedQuote: { provider: 'pancakeswap', chainId: 56, sellToken: SELL, buyToken: BUY, mode: 'EXACT_INPUT', sellAmount: '100', buyAmount: '200', expiresAt: '2999-01-01T00:00:00.000Z', allowanceTarget: PERMIT2, transaction: { to: ROUTER, data: '0x1234', value: '0' }, approval: { mode: 'permit2-allowance', contract: PERMIT2, spender: ROUTER, token: SELL, requiredAmount: '100' }, ...overrides } }
}

describe('refreshed quote validation', () => {
    it('returns a quote that preserves the confirmed intent and approval binding', () => {
        const refreshed = quote()
        expect(validateRefreshedQuote({ refreshedQuote: refreshed, previousQuote: quote(), snapshot, account: ACCOUNT, chainId: 56, sellToken: SELL, buyToken: BUY })).toBe(refreshed)
    })

    it.each([
        ['account', { account: ROUTER }, 'connected wallet'],
        ['chain', { chainId: 1 }, 'approved swap'],
        ['sell token', { sellToken: ROUTER }, 'approved swap'],
        ['amount', { refreshedQuote: quote({ sellAmount: '101' }) }, 'approved swap'],
        ['spender', { refreshedQuote: quote({ approval: { ...quote().selectedQuote.approval, spender: ACCOUNT } }) }, 'Permit2 authorization'],
    ])('rejects a refreshed %s mismatch', (_label, override, message) => {
        expect(() => validateRefreshedQuote({ refreshedQuote: quote(), previousQuote: quote(), snapshot, account: ACCOUNT, chainId: 56, sellToken: SELL, buyToken: BUY, ...override })).toThrow(message)
    })

    it('uses a typed safe error', () => {
        expect(() => validateRefreshedQuote({ refreshedQuote: quote({ chainId: 1 }), previousQuote: quote(), snapshot, account: ACCOUNT, chainId: 56, sellToken: SELL, buyToken: BUY })).toThrow(RefreshedQuoteValidationError)
    })
})
