import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { durableIntentInternals } from '../src/gas-assist/prepaid/durable-intent-service.js'

const migrationPath = fileURLToPath(
    new URL('../drizzle/0005_durable_sponsorship_intents.sql', import.meta.url),
)

describe('durable MegaFuel intents', () => {
    it('accepts only complete raw transaction bytes', () => {
        expect(durableIntentInternals.normalizedRawTransaction('0xAB12')).toBe('0xab12')
        expect(() => durableIntentInternals.normalizedRawTransaction('0xabc')).toThrow()
        expect(() => durableIntentInternals.normalizedRawTransaction('0xzz')).toThrow()
    })

    it('retries only stored, unexpired intents below the attempt cap', () => {
        const now = new Date('2026-07-21T20:00:00.000Z')
        const retryable = {
            status: 'unknown' as const,
            signedRawTransaction: '0x01' as const,
            broadcastAttempts: 1,
            lastBroadcastAt: new Date(now.getTime() - 15_001),
            expiresAt: new Date(now.getTime() + 60_000),
        }
        expect(durableIntentInternals.canRetryBroadcast(retryable, now)).toBe(true)
        expect(durableIntentInternals.canRetryBroadcast({
            ...retryable,
            broadcastAttempts: durableIntentInternals.MAX_BROADCAST_ATTEMPTS,
        }, now)).toBe(false)
        expect(durableIntentInternals.canRetryBroadcast({
            ...retryable,
            signedRawTransaction: null,
        }, now)).toBe(false)
        expect(durableIntentInternals.canRetryBroadcast({
            ...retryable,
            expiresAt: now,
        }, now)).toBe(false)
    })

    it('maps every signed action to its durable order step', () => {
        expect(durableIntentInternals.submittedOrderStatus(
            'fee-payment-transfer',
        )).toBe('payment-submitted')
        expect(durableIntentInternals.submittedOrderStatus(
            'token-approval',
        )).toBe('approval-submitted')
        expect(durableIntentInternals.submittedOrderStatus(
            'normal-swap',
        )).toBe('swap-submitted')
    })

    it('migrates raw-byte storage, event history, and current ledger names', () => {
        const migration = readFileSync(migrationPath, 'utf8')
        expect(migration).toContain('signed_raw_transaction text')
        expect(migration).toContain('broadcast_attempts integer')
        expect(migration).toContain('CREATE TABLE sponsorship_intent_events')
        expect(migration).toContain("'raw-transaction-received'")
        expect(migration).toContain("'broadcast-attempted'")
        expect(migration).toContain("'gasAndConversionReserve'")
        expect(migration).toContain("'serviceFeeReserved'")
        expect(migration).toContain("'refundPending'")
    })
})
