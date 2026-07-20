import { describe, expect, it } from 'vitest'

import {
    getExecutableTransaction,
    isQuoteExpired,
    isUserRejectedError,
} from './swapTransaction.js'

const TO = '0x0000000000000000000000000000000000000001'
const SELL = '0x0000000000000000000000000000000000000002'
const BUY = '0x0000000000000000000000000000000000000003'
const expected = { chainId: 56, sellToken: SELL, buyToken: BUY }

describe('swap transaction normalization', () => {
    it('uses the normalized quote transaction exactly', () => {
        expect(
            getExecutableTransaction({
                selectedQuote: {
                    chainId: 56,
                    sellToken: SELL,
                    buyToken: BUY,
                    transaction: {
                        to: TO,
                        data: '0x1234',
                        value: '7',
                        gas: '21000',
                    },
                },
            }, expected),
        ).toEqual({
            to: TO,
            data: '0x1234',
            value: 7n,
            gas: 21000n,
            chainId: 56,
        })
    })

    it('rejects malformed destinations and expired quotes', () => {
        expect(() =>
            getExecutableTransaction({
                selectedQuote: {
                    chainId: 56,
                    sellToken: SELL,
                    buyToken: BUY,
                    transaction: {
                        to: 'not-an-address',
                        data: '0x1234',
                        value: '0',
                    },
                },
            }, expected),
        ).toThrow('destination address')

        expect(
            isQuoteExpired({
                selectedQuote: {
                    expiresAt: '2020-01-01T00:00:00.000Z',
                },
            }),
        ).toBe(true)
    })

    it.each([
        ['chain', { chainId: 1, sellToken: SELL, buyToken: BUY }],
        ['sell token', { chainId: 56, sellToken: TO, buyToken: BUY }],
        ['buy token', { chainId: 56, sellToken: SELL, buyToken: TO }],
    ])('rejects a quote for the wrong %s before wallet submission', (_label, identity) => {
        expect(() => getExecutableTransaction({
            selectedQuote: {
                ...identity,
                transaction: { to: TO, data: '0x1234', value: '0' },
            },
        }, expected)).toThrow('selected chain and tokens')
    })

    it('distinguishes wallet rejection from provider failure', () => {
        expect(
            isUserRejectedError({ code: 4001 }),
        ).toBe(true)
        expect(
            isUserRejectedError(new Error('RPC unavailable')),
        ).toBe(false)
    })
})
