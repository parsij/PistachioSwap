import { describe, expect, it } from 'vitest'

import {
    getExecutableTransaction,
    isQuoteExpired,
    isUserRejectedError,
} from './swapTransaction.js'

const TO = '0x0000000000000000000000000000000000000001'

describe('swap transaction normalization', () => {
    it('uses the normalized quote transaction exactly', () => {
        expect(
            getExecutableTransaction({
                selectedQuote: {
                    transaction: {
                        to: TO,
                        data: '0x1234',
                        value: '7',
                        gas: '21000',
                    },
                },
            }),
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
                    transaction: {
                        to: 'not-an-address',
                        data: '0x1234',
                        value: '0',
                    },
                },
            }),
        ).toThrow('destination address')

        expect(
            isQuoteExpired({
                selectedQuote: {
                    expiresAt: '2020-01-01T00:00:00.000Z',
                },
            }),
        ).toBe(true)
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
