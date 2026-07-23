import { describe, expect, it, vi } from 'vitest'

import {
    expireUnsignedOrderAfterPackagePrepareError,
    orderLifecycleInternals,
    reconcileWalletBeforeOrderCreate,
} from '../src/gas-assist/prepaid/order-lifecycle.js'

function fakeDatabase({
    expiredOrderIds = [],
    blockingOrder = null,
    packageCandidate = true,
}: {
    expiredOrderIds?: string[]
    blockingOrder?: Record<string, unknown> | null
    packageCandidate?: boolean
} = {}) {
    const query = vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' ||
            sql.includes('pg_advisory_xact_lock')) {
            return { rows: [], rowCount: 0 }
        }
        if (sql.includes('REPLACED_UNSIGNED_ORDER') &&
            sql.includes('RETURNING o.id')) {
            return {
                rows: expiredOrderIds.map((id) => ({ id })),
                rowCount: expiredOrderIds.length,
            }
        }
        if (sql.includes('AS "preSignedPackage"')) {
            return {
                rows: blockingOrder ? [blockingOrder] : [],
                rowCount: blockingOrder ? 1 : 0,
            }
        }
        if (sql.includes("o.status IN ('quoted','payment-prepared')") &&
            sql.includes('FOR UPDATE')) {
            return {
                rows: packageCandidate ? [{ id: 'order-1' }] : [],
                rowCount: packageCandidate ? 1 : 0,
            }
        }
        if (sql.includes('UPDATE sponsorship_transaction_intents') ||
            sql.includes('UPDATE sponsorship_orders')) {
            return { rows: [], rowCount: 1 }
        }
        throw new Error(`Unexpected SQL in test: ${sql}`)
    })
    const release = vi.fn()
    return {
        pool: {
            connect: vi.fn(async () => ({ query, release })),
        } as never,
        query,
        release,
    }
}

describe('sponsorship order lifecycle', () => {
    it('expires replaceable unsigned orders before creating a new one', async () => {
        const database = fakeDatabase({ expiredOrderIds: ['order-old'] })

        await expect(reconcileWalletBeforeOrderCreate(
            '0xe448AF520b5a16293321cf0251c97fD4A1486Ce0',
            database.pool,
        )).resolves.toEqual({ expiredOrderIds: ['order-old'] })

        expect(database.query).toHaveBeenCalledWith('COMMIT')
        expect(database.release).toHaveBeenCalledOnce()
    })

    it('keeps a signed or ambiguous order blocking and returns resumable details', async () => {
        const expiresAt = new Date('2026-07-22T09:00:00.000Z')
        const database = fakeDatabase({
            blockingOrder: {
                id: 'order-live',
                status: 'payment-prepared',
                expiresAt,
                preSignedPackage: true,
                hasAmbiguousIntent: true,
            },
        })

        await expect(reconcileWalletBeforeOrderCreate(
            '0xe448AF520b5a16293321cf0251c97fD4A1486Ce0',
            database.pool,
        )).rejects.toMatchObject({
            code: 'ACTIVE_ORDER_EXISTS',
            statusCode: 409,
            details: {
                orderId: 'order-live',
                status: 'payment-prepared',
                expiresAt: expiresAt.toISOString(),
                preSignedPackage: true,
                ambiguous: true,
                resumable: true,
            },
        })

        expect(database.query).toHaveBeenCalledWith('COMMIT')
    })

    it('expires package preparation failures only while the order remains unsigned', async () => {
        const database = fakeDatabase({ packageCandidate: true })

        await expect(expireUnsignedOrderAfterPackagePrepareError(
            'order-1',
            '0xe448AF520b5a16293321cf0251c97fD4A1486Ce0',
            Object.assign(new Error('Price moved.'), {
                code: 'ORDER_REQUOTE_REQUIRED',
            }),
            database.pool,
        )).resolves.toEqual({
            expired: true,
            reason: 'unsigned-order-expired',
        })

        expect(database.query).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE sponsorship_orders'),
            ['order-1', 'PACKAGE_PREPARE_FAILED:ORDER_REQUOTE_REQUIRED'],
        )
    })

    it('refuses cleanup when signed, submitted, or state-changed data exists', async () => {
        const database = fakeDatabase({ packageCandidate: false })

        await expect(expireUnsignedOrderAfterPackagePrepareError(
            'order-1',
            '0xe448AF520b5a16293321cf0251c97fD4A1486Ce0',
            Object.assign(new Error('Price moved.'), {
                code: 'ORDER_REQUOTE_REQUIRED',
            }),
            database.pool,
        )).resolves.toEqual({
            expired: false,
            reason: 'unsafe-or-state-changed',
        })

        expect(database.query).not.toHaveBeenCalledWith(
            expect.stringContaining('UPDATE sponsorship_orders'),
            expect.anything(),
        )
    })

    it('sanitizes stored package preparation failure codes', () => {
        expect(orderLifecycleInternals.safeErrorCode({
            code: 'ORDER REQUOTE/REQUIRED?',
        })).toBe('ORDER_REQUOTE_REQUIRED_')
    })
})
