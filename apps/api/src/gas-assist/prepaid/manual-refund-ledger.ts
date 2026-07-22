import { appendFile, chmod, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getPool } from '../../db/client.js'
import {
    sponsorshipTrace,
    sponsorshipTraceError,
} from '../trace.js'

type QueryResult = { rows: Record<string, unknown>[] }
type Queryable = {
    query(text: string, values?: unknown[]): Promise<QueryResult>
}

type ManualRefundLedgerOptions = {
    database?: Queryable
    enabled?: boolean
    ledgerPath?: string
    now?: () => Date
}

type RefundSnapshot = {
    orderId: string
    walletAddress: string
    chainId: number
    tokenAddress: string
    tokenDecimals: number | null
    grossPaymentRaw: string
    actualSponsoredGasUsdMicros: string
    estimatedRefundGasUsdMicros: string | null
    refundableTokenAmountRaw: string | null
    refundStatus: string | null
    reason: string
    refundTransactionHash: string | null
    refundCreatedAt: Date | string | null
    refundUpdatedAt: Date | string | null
    orderStatus: string
    failureCode: string | null
    feeConfirmedAt: Date | string | null
    paymentTransactionHash: string | null
    approvalTransactionHash: string | null
    swapTransactionHash: string | null
    orderCreatedAt: Date | string
    orderUpdatedAt: Date | string
}

type IntentSnapshot = {
    action: string
    status: string
    nonce: string
    transactionHash: string | null
    failureCode: string | null
    submissionAttempts: number
    broadcastAttempts: number
    firstBroadcastAt: Date | string | null
    submittedAt: Date | string | null
    finalizedAt: Date | string | null
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
    return configured
        ? resolve(configured)
        : resolve(API_ROOT, 'data/manual-refund-candidates.jsonl')
}

function iso(value: Date | string | null | undefined) {
    if (!value) return null
    const date = value instanceof Date ? value : new Date(value)
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

function asRefundSnapshot(row: Record<string, unknown>): RefundSnapshot {
    return {
        orderId: String(row.orderId),
        walletAddress: String(row.walletAddress).toLowerCase(),
        chainId: Number(row.chainId ?? 56),
        tokenAddress: String(row.tokenAddress).toLowerCase(),
        tokenDecimals: row.tokenDecimals === null || row.tokenDecimals === undefined
            ? null
            : Number(row.tokenDecimals),
        grossPaymentRaw: String(row.grossPaymentRaw ?? '0'),
        actualSponsoredGasUsdMicros: String(row.actualSponsoredGasUsdMicros ?? '0'),
        estimatedRefundGasUsdMicros: row.estimatedRefundGasUsdMicros === null || row.estimatedRefundGasUsdMicros === undefined
            ? null
            : String(row.estimatedRefundGasUsdMicros),
        refundableTokenAmountRaw: row.refundableTokenAmountRaw === null || row.refundableTokenAmountRaw === undefined
            ? null
            : String(row.refundableTokenAmountRaw),
        refundStatus: row.refundStatus === null || row.refundStatus === undefined
            ? null
            : String(row.refundStatus),
        reason: safeText(row.reason ?? row.failureCode, 'manual-review-required'),
        refundTransactionHash: safeHash(row.refundTransactionHash),
        refundCreatedAt: row.refundCreatedAt as Date | string | null,
        refundUpdatedAt: row.refundUpdatedAt as Date | string | null,
        orderStatus: String(row.orderStatus),
        failureCode: row.failureCode ? safeText(row.failureCode) : null,
        feeConfirmedAt: row.feeConfirmedAt as Date | string | null,
        paymentTransactionHash: safeHash(row.paymentTransactionHash),
        approvalTransactionHash: safeHash(row.approvalTransactionHash),
        swapTransactionHash: safeHash(row.swapTransactionHash),
        orderCreatedAt: row.orderCreatedAt as Date | string,
        orderUpdatedAt: row.orderUpdatedAt as Date | string,
    }
}

function asIntentSnapshot(row: Record<string, unknown>): IntentSnapshot {
    return {
        action: String(row.action),
        status: String(row.status),
        nonce: String(row.nonce),
        transactionHash: safeHash(row.transactionHash),
        failureCode: row.failureCode ? safeText(row.failureCode) : null,
        submissionAttempts: Number(row.submissionAttempts ?? 0),
        broadcastAttempts: Number(row.broadcastAttempts ?? 0),
        firstBroadcastAt: row.firstBroadcastAt as Date | string | null,
        submittedAt: row.submittedAt as Date | string | null,
        finalizedAt: row.finalizedAt as Date | string | null,
    }
}

async function loadRefundSnapshots(database: Queryable) {
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

    return [...refunds.rows, ...unexplained.rows].map(asRefundSnapshot)
}

async function loadIntentSnapshots(database: Queryable, orderId: string) {
    const result = await database.query(
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
    )
    return result.rows.map(asIntentSnapshot)
}

function ledgerEvent(snapshot: RefundSnapshot, intents: IntentSnapshot[], detectedAt: string) {
    const event = snapshot.refundStatus === 'sent'
        ? 'refund_sent'
        : snapshot.refundStatus === 'pending'
            ? 'refund_candidate'
            : 'needs_review'
    const refundHash = safeHash(snapshot.refundTransactionHash)
    const eventKey = event === 'refund_sent'
        ? `${event}:${snapshot.orderId}:${refundHash ?? 'missing-hash'}`
        : `${event}:${snapshot.orderId}`

    const intentByAction = new Map(intents.map((intent) => [intent.action, intent]))
    const action = (name: string, orderHash: string | null) => {
        const intent = intentByAction.get(name)
        return {
            status: intent?.status ?? null,
            nonce: intent?.nonce ?? null,
            transactionHash: intent?.transactionHash ?? orderHash,
            failureCode: intent?.failureCode ?? null,
            submissionAttempts: intent?.submissionAttempts ?? 0,
            broadcastAttempts: intent?.broadcastAttempts ?? 0,
            firstBroadcastAt: iso(intent?.firstBroadcastAt),
            submittedAt: iso(intent?.submittedAt),
            finalizedAt: iso(intent?.finalizedAt),
        }
    }

    return {
        version: 1,
        event,
        eventKey,
        orderId: snapshot.orderId,
        chainId: snapshot.chainId,
        walletAddress: snapshot.walletAddress,
        detectedAt,
        order: {
            status: snapshot.orderStatus,
            failureCode: snapshot.failureCode,
            createdAt: iso(snapshot.orderCreatedAt),
            updatedAt: iso(snapshot.orderUpdatedAt),
            feeConfirmedAt: iso(snapshot.feeConfirmedAt),
        },
        payment: {
            tokenAddress: snapshot.tokenAddress,
            tokenDecimals: snapshot.tokenDecimals,
            grossAmountRaw: snapshot.grossPaymentRaw,
            ...action('fee-payment-transfer', snapshot.paymentTransactionHash),
        },
        approval: action('token-approval', snapshot.approvalTransactionHash),
        swap: action('normal-swap', snapshot.swapTransactionHash),
        accounting: {
            actualSponsoredGasUsdMicros: snapshot.actualSponsoredGasUsdMicros,
            estimatedRefundGasUsdMicros: snapshot.estimatedRefundGasUsdMicros,
            refundablePaymentTokenAmountRaw: snapshot.refundableTokenAmountRaw,
        },
        refund: {
            status: snapshot.refundStatus ?? 'needs-review',
            reason: snapshot.reason,
            recommendedAsset: 'BNB',
            suggestedAmountWei: null,
            manualReviewRequired: event !== 'refund_sent',
            refundTransactionHash: refundHash,
            createdAt: iso(snapshot.refundCreatedAt),
            updatedAt: iso(snapshot.refundUpdatedAt),
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
            // Preserve append-only recovery even if a manually edited line is malformed.
        }
    }
    return keys
}

export function createManualRefundLedger(options: ManualRefundLedgerOptions = {}) {
    const database = options.database ?? getPool() as unknown as Queryable
    const enabled = options.enabled ?? configuredEnabled()
    const ledgerPath = options.ledgerPath ?? configuredLedgerPath()
    const now = options.now ?? (() => new Date())
    let queue: Promise<unknown> = Promise.resolve()

    async function syncInternal() {
        if (!enabled) return { enabled: false, ledgerPath, appended: 0, scanned: 0 }

        const snapshots = await loadRefundSnapshots(database)
        const detectedAt = now().toISOString()
        const events = []
        for (const snapshot of snapshots) {
            const intents = await loadIntentSnapshots(database, snapshot.orderId)
            events.push(ledgerEvent(snapshot, intents, detectedAt))
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
            sponsorshipTraceError('refund.manual-ledger.error', error, { ledgerPath })
        })
        return result
    }

    return { sync, ledgerPath }
}

export const manualRefundLedger = createManualRefundLedger()

export const manualRefundLedgerInternals = {
    configuredEnabled,
    configuredLedgerPath,
    existingEventKeys,
    iso,
    ledgerEvent,
    safeHash,
    safeText,
}
