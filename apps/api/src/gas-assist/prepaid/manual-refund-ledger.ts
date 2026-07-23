import { appendFile, chmod, mkdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getPool } from '../../db/client.js'
import {
    sponsorshipTrace,
    sponsorshipTraceError,
} from '../trace.js'

export type ManualRefundLedgerQueryable = {
    query(
        text: string,
        values?: unknown[],
    ): Promise<{ rows: Record<string, unknown>[] }>
}

export type ManualRefundLedgerOptions = {
    database?: ManualRefundLedgerQueryable
    enabled?: boolean
    ledgerPath?: string
    now?: () => Date
}

const API_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/i

function configuredEnabled() {
    return process.env.MANUAL_REFUND_LEDGER_ENABLED?.trim().toLowerCase() !== 'false'
}

function configuredLedgerPath() {
    const configured = process.env.MANUAL_REFUND_LEDGER_PATH?.trim()
    if (configured?.includes('\0')) {
        throw new Error('MANUAL_REFUND_LEDGER_PATH contains an invalid null byte.')
    }
    if (!configured) {
        return resolve(API_ROOT, 'data/manual-refund-candidates.jsonl')
    }
    return isAbsolute(configured)
        ? resolve(configured)
        : resolve(API_ROOT, configured)
}

function iso(value: unknown) {
    if (!value) return null
    const date = value instanceof Date ? value : new Date(String(value))
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function safeHash(value: unknown) {
    const normalized = String(value ?? '').trim().toLowerCase()
    return TRANSACTION_HASH.test(normalized) ? normalized : null
}

function safeText(value: unknown, fallback = '') {
    return String(value ?? fallback)
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, 240)
}

async function loadRefundRows(database: ManualRefundLedgerQueryable) {
    const refunds = await database.query(
        `SELECT
            r.order_id AS "orderId",
            r.wallet_address AS "walletAddress",
            r.chain_id AS "chainId",
            r.token_address AS "tokenAddress",
            o.payment_token_decimals AS "tokenDecimals",
            r.gross_payment_raw::text AS "grossPaymentRaw",
            r.actual_sponsored_gas_usd_micros::text AS "actualSponsoredGasUsdMicros",
            r.estimated_refund_gas_usd_micros::text AS "estimatedRefundGasUsdMicros",
            r.refundable_token_amount_raw::text AS "refundableTokenAmountRaw",
            r.status AS "refundStatus",
            r.reason,
            r.refund_transaction_hash AS "refundTransactionHash",
            r.created_at AS "refundCreatedAt",
            r.updated_at AS "refundUpdatedAt",
            o.status AS "orderStatus",
            o.rejection_code AS "failureCode",
            o.fee_confirmed_at AS "feeConfirmedAt",
            o.payment_transaction_hash AS "paymentTransactionHash",
            o.approval_transaction_hash AS "approvalTransactionHash",
            o.swap_transaction_hash AS "swapTransactionHash",
            o.created_at AS "orderCreatedAt",
            o.updated_at AS "orderUpdatedAt"
         FROM sponsorship_refunds r
         JOIN sponsorship_orders o ON o.id=r.order_id
         WHERE r.status IN ('pending','needs-review','sent')
         ORDER BY r.created_at ASC`,
    )
    const unexplained = await database.query(
        `SELECT
            o.id AS "orderId",
            o.wallet_address AS "walletAddress",
            o.chain_id AS "chainId",
            o.payment_token AS "tokenAddress",
            o.payment_token_decimals AS "tokenDecimals",
            o.payment_amount_raw::text AS "grossPaymentRaw",
            COALESCE(o.actual_sponsored_gas_usd_micros,0)::text AS "actualSponsoredGasUsdMicros",
            NULL::text AS "estimatedRefundGasUsdMicros",
            NULL::text AS "refundableTokenAmountRaw",
            NULL::text AS "refundStatus",
            COALESCE(o.rejection_code,'UNEXPLAINED_POST_PAYMENT_FAILURE') AS reason,
            NULL::text AS "refundTransactionHash",
            NULL::timestamptz AS "refundCreatedAt",
            NULL::timestamptz AS "refundUpdatedAt",
            o.status AS "orderStatus",
            o.rejection_code AS "failureCode",
            o.fee_confirmed_at AS "feeConfirmedAt",
            o.payment_transaction_hash AS "paymentTransactionHash",
            o.approval_transaction_hash AS "approvalTransactionHash",
            o.swap_transaction_hash AS "swapTransactionHash",
            o.created_at AS "orderCreatedAt",
            o.updated_at AS "orderUpdatedAt"
         FROM sponsorship_orders o
         WHERE o.status IN ('unknown','failed')
           AND o.fee_confirmed_at IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM sponsorship_refunds r WHERE r.order_id=o.id
           )
         ORDER BY o.created_at ASC`,
    )
    return [...refunds.rows, ...unexplained.rows]
}

async function loadIntents(
    database: ManualRefundLedgerQueryable,
    orderId: string,
) {
    return (await database.query(
        `SELECT action,status,nonce::text,
                transaction_hash AS "transactionHash",
                failure_code AS "failureCode",
                submission_attempts AS "submissionAttempts",
                broadcast_attempts AS "broadcastAttempts",
                first_broadcast_at AS "firstBroadcastAt",
                submitted_at AS "submittedAt",
                finalized_at AS "finalizedAt"
         FROM sponsorship_transaction_intents
         WHERE order_id=$1
         ORDER BY CASE action
             WHEN 'fee-payment-transfer' THEN 1
             WHEN 'token-approval' THEN 2
             WHEN 'normal-swap' THEN 3
             ELSE 4 END`,
        [orderId],
    )).rows
}

function buildLedgerEvent(
    row: Record<string, unknown>,
    intents: Record<string, unknown>[],
    detectedAt: string,
) {
    const orderId = String(row.orderId)
    const refundHash = safeHash(row.refundTransactionHash)
    const refundStatus = row.refundStatus === null || row.refundStatus === undefined
        ? null
        : String(row.refundStatus)
    const event = refundStatus === 'sent' && refundHash
        ? 'refund_sent'
        : refundStatus === 'pending'
            ? 'refund_candidate'
            : 'needs_review'
    const eventKey = event === 'refund_sent'
        ? `${event}:${orderId}:${refundHash}`
        : `${event}:${orderId}`
    const byAction = new Map(intents.map((intent) => [String(intent.action), intent]))
    const action = (name: string, fallbackHash: unknown) => {
        const intent = byAction.get(name)
        return {
            status: intent ? String(intent.status) : null,
            nonce: intent ? String(intent.nonce) : null,
            transactionHash: safeHash(intent?.transactionHash) ?? safeHash(fallbackHash),
            failureCode: intent?.failureCode ? safeText(intent.failureCode) : null,
            submissionAttempts: Number(intent?.submissionAttempts ?? 0),
            broadcastAttempts: Number(intent?.broadcastAttempts ?? 0),
            firstBroadcastAt: iso(intent?.firstBroadcastAt),
            submittedAt: iso(intent?.submittedAt),
            finalizedAt: iso(intent?.finalizedAt),
        }
    }

    return {
        version: 1,
        event,
        eventKey,
        orderId,
        chainId: Number(row.chainId ?? 56),
        walletAddress: String(row.walletAddress).toLowerCase(),
        detectedAt,
        order: {
            status: String(row.orderStatus),
            failureCode: row.failureCode ? safeText(row.failureCode) : null,
            createdAt: iso(row.orderCreatedAt),
            updatedAt: iso(row.orderUpdatedAt),
            feeConfirmedAt: iso(row.feeConfirmedAt),
        },
        payment: {
            tokenAddress: String(row.tokenAddress).toLowerCase(),
            tokenDecimals: row.tokenDecimals === null || row.tokenDecimals === undefined
                ? null
                : Number(row.tokenDecimals),
            grossAmountRaw: String(row.grossPaymentRaw ?? '0'),
            ...action('fee-payment-transfer', row.paymentTransactionHash),
        },
        approval: action('token-approval', row.approvalTransactionHash),
        swap: action('normal-swap', row.swapTransactionHash),
        accounting: {
            actualSponsoredGasUsdMicros: String(row.actualSponsoredGasUsdMicros ?? '0'),
            estimatedRefundGasUsdMicros: row.estimatedRefundGasUsdMicros === null || row.estimatedRefundGasUsdMicros === undefined
                ? null
                : String(row.estimatedRefundGasUsdMicros),
            refundablePaymentTokenAmountRaw: row.refundableTokenAmountRaw === null || row.refundableTokenAmountRaw === undefined
                ? null
                : String(row.refundableTokenAmountRaw),
        },
        refund: {
            status: event === 'refund_sent'
                ? 'sent'
                : event === 'refund_candidate'
                    ? 'pending'
                    : 'needs-review',
            reason: safeText(row.reason ?? row.failureCode, 'manual-review-required'),
            recommendedAsset: 'BNB',
            suggestedAmountWei: null,
            manualReviewRequired: event !== 'refund_sent',
            refundTransactionHash: refundHash,
            createdAt: iso(row.refundCreatedAt),
            updatedAt: iso(row.refundUpdatedAt),
        },
    }
}

async function existingEventKeys(ledgerPath: string) {
    const keys = new Set<string>()
    let content = ''
    try {
        content = await readFile(ledgerPath, 'utf8')
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        return keys
    }
    for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
            const parsed = JSON.parse(line) as { eventKey?: unknown }
            if (typeof parsed.eventKey === 'string') keys.add(parsed.eventKey)
        } catch {
            // A manually damaged line does not prevent later append-only recovery.
        }
    }
    return keys
}

export function createManualRefundLedger(
    options: ManualRefundLedgerOptions = {},
) {
    const enabled = options.enabled ?? configuredEnabled()
    const ledgerPath = options.ledgerPath ?? configuredLedgerPath()
    const now = options.now ?? (() => new Date())
    let queue: Promise<unknown> = Promise.resolve()

    async function syncInternal() {
        if (!enabled) {
            return { enabled: false, ledgerPath, appended: 0, scanned: 0 }
        }
        const database = options.database ??
            getPool() as unknown as ManualRefundLedgerQueryable
        const rows = await loadRefundRows(database)
        const detectedAt = now().toISOString()
        const events = []
        for (const row of rows) {
            const orderId = String(row.orderId)
            events.push(buildLedgerEvent(
                row,
                await loadIntents(database, orderId),
                detectedAt,
            ))
        }

        await mkdir(dirname(ledgerPath), { recursive: true, mode: 0o700 })
        const known = await existingEventKeys(ledgerPath)
        const pending = events.filter((event) => !known.has(event.eventKey))
        if (pending.length > 0) {
            await appendFile(
                ledgerPath,
                `${pending.map((event) => JSON.stringify(event)).join('\n')}\n`,
                { encoding: 'utf8', flag: 'a', mode: 0o600 },
            )
            await chmod(ledgerPath, 0o600)
            sponsorshipTrace('refund.manual-ledger.appended', {
                ledgerPath,
                eventKeys: pending.map((event) => event.eventKey),
            })
        }
        return {
            enabled: true,
            ledgerPath,
            appended: pending.length,
            scanned: events.length,
        }
    }

    function sync() {
        const result = queue.then(syncInternal, syncInternal)
        queue = result.catch((error) => {
            sponsorshipTraceError('refund.manual-ledger.error', error, {
                ledgerPath,
            })
        })
        return result
    }

    return { sync, ledgerPath }
}

export const manualRefundLedger = createManualRefundLedger()

export const manualRefundLedgerInternals = {
    buildLedgerEvent,
    configuredEnabled,
    configuredLedgerPath,
    existingEventKeys,
    iso,
    safeHash,
    safeText,
}
