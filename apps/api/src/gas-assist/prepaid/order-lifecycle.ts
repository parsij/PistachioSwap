import type { Pool } from 'pg'

import { getPool } from '../../db/client.js'
import { GasAssistError } from '../errors.js'
import {
    sponsorshipTrace,
    sponsorshipTraceError,
} from '../trace.js'

type BlockingOrderRow = {
    id: string
    status: string
    expiresAt: Date
    preSignedPackage: boolean
    hasAmbiguousIntent: boolean
}

function safeErrorCode(error: unknown) {
    if (error && typeof error === 'object' && 'code' in error) {
        return String((error as { code?: unknown }).code ?? 'UNKNOWN')
            .replace(/[^A-Z0-9_:-]/gi, '_')
            .slice(0, 80)
    }
    return 'UNKNOWN'
}

const UNSAFE_INTENT_SQL = `(
    i.signed_raw_transaction IS NOT NULL OR
    i.signed_raw_transaction_hash IS NOT NULL OR
    i.transaction_hash IS NOT NULL OR
    i.submission_attempts > 0 OR
    i.status IN (
        'signing','submitting','submitted','confirmed','reverted','unknown'
    )
)`

/**
 * Replaces only abandoned, unsigned draft/package rows before a new order.
 * A signed, submitted, confirmed, reverted, or ambiguous order remains blocking.
 */
export async function reconcileWalletBeforeOrderCreate(
    walletAddress: string,
    database: Pool = getPool(),
) {
    const wallet = walletAddress.toLowerCase()
    const client = await database.connect()
    let blockingOrder: BlockingOrderRow | null = null
    let expiredOrderIds: string[] = []

    try {
        await client.query('BEGIN')
        await client.query(
            'SELECT pg_advisory_xact_lock(hashtext($1))',
            [`sponsorship-wallet:${wallet}`],
        )

        const expired = await client.query<{ id: string }>(
            `WITH candidates AS (
                SELECT o.id
                FROM sponsorship_orders o
                WHERE o.wallet_address=$1
                  AND o.status IN ('quoted','payment-prepared')
                  AND o.payment_transaction_hash IS NULL
                  AND o.approval_transaction_hash IS NULL
                  AND o.swap_transaction_hash IS NULL
                  AND NOT EXISTS (
                      SELECT 1
                      FROM sponsorship_transaction_intents i
                      WHERE i.order_id=o.id
                        AND ${UNSAFE_INTENT_SQL}
                  )
                FOR UPDATE
            ), expired_intents AS (
                UPDATE sponsorship_transaction_intents i
                SET status='expired',
                    failure_code=COALESCE(
                        i.failure_code,
                        'REPLACED_UNSIGNED_ORDER'
                    ),
                    updated_at=now()
                FROM candidates c
                WHERE i.order_id=c.id
                  AND i.status IN ('authorized','prepared')
                  AND i.signed_raw_transaction IS NULL
                  AND i.signed_raw_transaction_hash IS NULL
                  AND i.transaction_hash IS NULL
                  AND i.submission_attempts=0
                RETURNING i.id
            )
            UPDATE sponsorship_orders o
            SET status='expired',
                rejection_code='REPLACED_UNSIGNED_ORDER',
                updated_at=now()
            FROM candidates c
            WHERE o.id=c.id
            RETURNING o.id`,
            [wallet],
        )
        expiredOrderIds = expired.rows.map((row) => row.id)

        const blocking = await client.query<BlockingOrderRow>(
            `SELECT
                o.id,
                o.status,
                o.expires_at AS "expiresAt",
                (
                    SELECT count(*)=3
                    FROM sponsorship_transaction_intents i
                    WHERE i.order_id=o.id
                      AND i.signed_raw_transaction IS NOT NULL
                ) AS "preSignedPackage",
                EXISTS (
                    SELECT 1
                    FROM sponsorship_transaction_intents i
                    WHERE i.order_id=o.id
                      AND ${UNSAFE_INTENT_SQL}
                ) AS "hasAmbiguousIntent"
             FROM sponsorship_orders o
             WHERE o.wallet_address=$1
               AND o.status NOT IN ('completed','expired','rejected','failed')
             ORDER BY o.created_at DESC
             LIMIT 1
             FOR UPDATE`,
            [wallet],
        )
        blockingOrder = blocking.rows[0] ?? null
        await client.query('COMMIT')
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        sponsorshipTraceError(
            'order.lifecycle.pre-create.error',
            error,
            { walletAddress: wallet },
        )
        throw error
    } finally {
        client.release()
    }

    if (expiredOrderIds.length > 0) {
        sponsorshipTrace('order.lifecycle.unsigned-replaced', {
            walletAddress: wallet,
            expiredOrderIds,
        })
    }

    if (blockingOrder) {
        throw new GasAssistError(
            'ACTIVE_ORDER_EXISTS',
            blockingOrder.preSignedPackage
                ? 'A signed Gas Assist swap is already being processed.'
                : 'A Gas Assist order is already active for this wallet.',
            409,
            {
                orderId: blockingOrder.id,
                status: blockingOrder.status,
                expiresAt: blockingOrder.expiresAt.toISOString(),
                preSignedPackage: blockingOrder.preSignedPackage,
                ambiguous: blockingOrder.hasAmbiguousIntent,
                resumable: blockingOrder.preSignedPackage,
            },
        )
    }

    return { expiredOrderIds }
}

/**
 * Expires a package only when preparation failed before any signature,
 * submission attempt, or transaction hash exists.
 */
export async function expireUnsignedOrderAfterPackagePrepareError(
    orderId: string,
    walletAddress: string,
    error: unknown,
    database: Pool = getPool(),
) {
    const wallet = walletAddress.toLowerCase()
    const failureCode = `PACKAGE_PREPARE_FAILED:${safeErrorCode(error)}`
    const client = await database.connect()

    try {
        await client.query('BEGIN')
        const candidate = await client.query<{ id: string }>(
            `SELECT o.id
             FROM sponsorship_orders o
             WHERE o.id=$1
               AND o.wallet_address=$2
               AND o.status IN ('quoted','payment-prepared')
               AND o.payment_transaction_hash IS NULL
               AND o.approval_transaction_hash IS NULL
               AND o.swap_transaction_hash IS NULL
               AND NOT EXISTS (
                   SELECT 1
                   FROM sponsorship_transaction_intents i
                   WHERE i.order_id=o.id
                     AND ${UNSAFE_INTENT_SQL}
               )
             FOR UPDATE`,
            [orderId, wallet],
        )

        if (!candidate.rows[0]) {
            await client.query('COMMIT')
            sponsorshipTrace('order.lifecycle.prepare-error-not-expired', {
                orderId,
                walletAddress: wallet,
                reason: 'signed-submitted-terminal-or-state-changed',
                failureCode,
            })
            return {
                expired: false,
                reason: 'unsafe-or-state-changed' as const,
            }
        }

        await client.query(
            `UPDATE sponsorship_transaction_intents
             SET status='expired',
                 failure_code=COALESCE(failure_code,$2),
                 updated_at=now()
             WHERE order_id=$1
               AND status IN ('authorized','prepared')
               AND signed_raw_transaction IS NULL
               AND signed_raw_transaction_hash IS NULL
               AND transaction_hash IS NULL
               AND submission_attempts=0`,
            [orderId, failureCode],
        )
        await client.query(
            `UPDATE sponsorship_orders
             SET status='expired',
                 rejection_code=$2,
                 updated_at=now()
             WHERE id=$1`,
            [orderId, failureCode],
        )
        await client.query('COMMIT')
        sponsorshipTrace('order.lifecycle.prepare-error-expired', {
            orderId,
            walletAddress: wallet,
            failureCode,
        })
        return { expired: true, reason: 'unsigned-order-expired' as const }
    } catch (cleanupError) {
        await client.query('ROLLBACK').catch(() => undefined)
        sponsorshipTraceError(
            'order.lifecycle.prepare-error-cleanup-failed',
            cleanupError,
            {
                orderId,
                walletAddress: wallet,
                originalFailureCode: failureCode,
            },
        )
        return { expired: false, reason: 'cleanup-failed' as const }
    } finally {
        client.release()
    }
}

export const orderLifecycleInternals = {
    safeErrorCode,
}
