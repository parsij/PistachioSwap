import { describe, expect, it } from 'vitest'

import { sponsorshipPackageInternals } from '../src/gas-assist/prepaid/package-service.js'

const {
    PACKAGE_ACTIONS,
    PACKAGE_TTL_SECONDS,
    assertPackageActions,
    nextActionForStatus,
    normalizedRawTransaction,
    unsignedTransaction,
} = sponsorshipPackageInternals

describe('pre-signed sponsorship package', () => {
    it('requires exactly one fee, approval, and swap action in execution order', () => {
        const values = [
            { action: 'normal-swap' as const, marker: 3 },
            { action: 'fee-payment-transfer' as const, marker: 1 },
            { action: 'token-approval' as const, marker: 2 },
        ]

        expect(assertPackageActions(values).map((value) => value.marker))
            .toEqual([1, 2, 3])
        expect(PACKAGE_ACTIONS).toEqual([
            'fee-payment-transfer',
            'token-approval',
            'normal-swap',
        ])
    })

    it('rejects incomplete or duplicate action sets', () => {
        expect(() => assertPackageActions([
            { action: 'fee-payment-transfer' as const },
            { action: 'token-approval' as const },
        ])).toThrowError(/all required/i)

        expect(() => assertPackageActions([
            { action: 'fee-payment-transfer' as const },
            { action: 'token-approval' as const },
            { action: 'token-approval' as const },
        ])).toThrowError(/exactly one/i)
    })

    it('advances only the signed action unlocked by the confirmed prior step', () => {
        expect(nextActionForStatus('payment-prepared')).toBe('fee-payment-transfer')
        expect(nextActionForStatus('payment-confirmed')).toBe('token-approval')
        expect(nextActionForStatus('approval-confirmed')).toBe('normal-swap')
        expect(nextActionForStatus('payment-submitted')).toBeNull()
        expect(nextActionForStatus('completed')).toBeNull()
    })

    it('creates a zero-gas-price legacy transaction with the assigned nonce', () => {
        expect(unsignedTransaction({
            walletAddress: '0x1111111111111111111111111111111111111111',
            transactionTo: '0x2222222222222222222222222222222222222222',
            transactionData: '0x1234',
            nonce: 42n,
            gasLimit: 150_000n,
        })).toEqual({
            from: '0x1111111111111111111111111111111111111111',
            to: '0x2222222222222222222222222222222222222222',
            data: '0x1234',
            value: '0x0',
            chainId: '0x38',
            nonce: '0x2a',
            gas: '0x249f0',
            gasPrice: '0x0',
            type: '0x0',
        })
        expect(PACKAGE_TTL_SECONDS).toBe(900)
    })

    it('normalizes complete signed bytes and rejects malformed input', () => {
        expect(normalizedRawTransaction('0xABCD')).toBe('0xabcd')
        expect(() => normalizedRawTransaction('0xabc')).toThrowError(/malformed/i)
        expect(() => normalizedRawTransaction('not-hex')).toThrowError(/malformed/i)
    })
})
