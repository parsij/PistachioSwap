import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    createManualRefundLedger,
    manualRefundLedgerInternals,
    type ManualRefundLedgerQueryable,
} from '../src/gas-assist/prepaid/manual-refund-ledger.js'

const PAYMENT_HASH = `0x${'1'.repeat(64)}`
const APPROVAL_HASH = `0x${'2'.repeat(64)}`
const SWAP_HASH = `0x${'3'.repeat(64)}`
const REFUND_HASH = `0x${'4'.repeat(64)}`

const temporaryDirectories: string[] = []

afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })))
})

async function temporaryLedgerPath() {
    const directory = await mkdtemp(join(tmpdir(), 'pistachio-refunds-'))
    temporaryDirectories.push(directory)
    return join(directory, 'manual-refund-candidates.jsonl')
}

function refundRow(overrides: Record<string, unknown> = {}) {
    return {
        orderId: 'order-1',
        walletAddress: '0xe448af520b5a16293321cf0251c97fd4a1486ce0',
        chainId: 56,
        tokenAddress: '0x21caef8a43163eea865baee23b9c2e327696a3bf',
        tokenDecimals: 6,
        grossPaymentRaw: '52',
        actualSponsoredGasUsdMicros: '12000',
        estimatedRefundGasUsdMicros: '8000',
        refundableTokenAmountRaw: '31',
        refundStatus: 'pending',
        reason: 'swap-reverted\nredacted-detail',
        refundTransactionHash: null,
        refundCreatedAt: new Date('2026-07-22T09:00:00.000Z'),
        refundUpdatedAt: new Date('2026-07-22T09:00:00.000Z'),
        orderStatus: 'failed',
        failureCode: 'SWAP_REVERTED',
        feeConfirmedAt: new Date('2026-07-22T08:59:00.000Z'),
        paymentTransactionHash: PAYMENT_HASH,
        approvalTransactionHash: APPROVAL_HASH,
        swapTransactionHash: SWAP_HASH,
        orderCreatedAt: new Date('2026-07-22T08:58:00.000Z'),
        orderUpdatedAt: new Date('2026-07-22T09:00:00.000Z'),
        ...overrides,
    }
}

function intentRows() {
    return [
        {
            action: 'fee-payment-transfer',
            status: 'confirmed',
            nonce: '11',
            transactionHash: PAYMENT_HASH,
            failureCode: null,
            submissionAttempts: 1,
            broadcastAttempts: 1,
            firstBroadcastAt: new Date('2026-07-22T08:59:01.000Z'),
            submittedAt: new Date('2026-07-22T08:59:02.000Z'),
            finalizedAt: new Date('2026-07-22T08:59:05.000Z'),
        },
        {
            action: 'token-approval',
            status: 'confirmed',
            nonce: '12',
            transactionHash: APPROVAL_HASH,
            failureCode: null,
            submissionAttempts: 1,
            broadcastAttempts: 1,
            firstBroadcastAt: new Date('2026-07-22T08:59:06.000Z'),
            submittedAt: new Date('2026-07-22T08:59:07.000Z'),
            finalizedAt: new Date('2026-07-22T08:59:10.000Z'),
        },
        {
            action: 'normal-swap',
            status: 'reverted',
            nonce: '13',
            transactionHash: SWAP_HASH,
            failureCode: 'TRANSACTION_REVERTED',
            submissionAttempts: 1,
            broadcastAttempts: 1,
            firstBroadcastAt: new Date('2026-07-22T08:59:11.000Z'),
            submittedAt: new Date('2026-07-22T08:59:12.000Z'),
            finalizedAt: new Date('2026-07-22T08:59:20.000Z'),
        },
    ]
}

function fakeDatabase({
    refunds = [refundRow()],
    unexplained = [],
}: {
    refunds?: Record<string, unknown>[]
    unexplained?: Record<string, unknown>[]
} = {}): ManualRefundLedgerQueryable {
    return {
        async query(text) {
            if (text.includes('FROM sponsorship_refunds r')) {
                return { rows: refunds }
            }
            if (text.includes('FROM sponsorship_orders o')) {
                return { rows: unexplained }
            }
            if (text.includes('FROM sponsorship_transaction_intents')) {
                return { rows: intentRows() }
            }
            throw new Error(`Unexpected query: ${text.slice(0, 80)}`)
        },
    }
}

async function readEvents(ledgerPath: string) {
    const content = await readFile(ledgerPath, 'utf8')
    return content.trim().split('\n').map((line) => JSON.parse(line))
}

describe('manual refund ledger', () => {
    it('appends one secret-safe refund candidate and deduplicates later recovery passes', async () => {
        const ledgerPath = await temporaryLedgerPath()
        const ledger = createManualRefundLedger({
            database: fakeDatabase(),
            ledgerPath,
            now: () => new Date('2026-07-22T09:01:00.000Z'),
        })

        await expect(ledger.sync()).resolves.toMatchObject({ appended: 1, scanned: 1 })
        await expect(ledger.sync()).resolves.toMatchObject({ appended: 0, scanned: 1 })

        const events = await readEvents(ledgerPath)
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
            event: 'refund_candidate',
            eventKey: 'refund_candidate:order-1',
            orderId: 'order-1',
            payment: { transactionHash: PAYMENT_HASH },
            approval: { transactionHash: APPROVAL_HASH },
            swap: {
                transactionHash: SWAP_HASH,
                status: 'reverted',
                failureCode: 'TRANSACTION_REVERTED',
            },
            refund: {
                recommendedAsset: 'BNB',
                suggestedAmountWei: null,
                manualReviewRequired: true,
            },
        })
        expect(events[0].refund.reason).toBe('swap-reverted redacted-detail')
        const serialized = JSON.stringify(events[0])
        expect(serialized).not.toContain('signedRawTransaction')
        expect(serialized).not.toContain('privateKey')
        expect(serialized).not.toContain('sessionToken')
        expect((await stat(ledgerPath)).mode & 0o777).toBe(0o600)
    })

    it('appends a separate refund_sent event after the manual refund hash is recorded', async () => {
        const ledgerPath = await temporaryLedgerPath()
        let status = 'pending'
        let refundTransactionHash: string | null = null
        const database = fakeDatabase({
            refunds: [],
        })
        database.query = async (text) => {
            if (text.includes('FROM sponsorship_refunds r')) {
                return {
                    rows: [refundRow({ refundStatus: status, refundTransactionHash })],
                }
            }
            if (text.includes('FROM sponsorship_orders o')) return { rows: [] }
            if (text.includes('FROM sponsorship_transaction_intents')) {
                return { rows: intentRows() }
            }
            throw new Error(`Unexpected query: ${text.slice(0, 80)}`)
        }
        const ledger = createManualRefundLedger({ database, ledgerPath })

        await ledger.sync()
        status = 'sent'
        refundTransactionHash = REFUND_HASH
        await ledger.sync()

        const events = await readEvents(ledgerPath)
        expect(events.map((event) => event.event)).toEqual([
            'refund_candidate',
            'refund_sent',
        ])
        expect(events[1]).toMatchObject({
            eventKey: `refund_sent:order-1:${REFUND_HASH}`,
            refund: {
                status: 'sent',
                manualReviewRequired: false,
                refundTransactionHash: REFUND_HASH,
            },
        })
    })

    it('records a payment-confirmed ambiguous order as needs_review without inventing a refund amount', async () => {
        const ledgerPath = await temporaryLedgerPath()
        const ledger = createManualRefundLedger({
            database: fakeDatabase({
                refunds: [],
                unexplained: [refundRow({
                    refundStatus: null,
                    estimatedRefundGasUsdMicros: null,
                    refundableTokenAmountRaw: null,
                    orderStatus: 'unknown',
                    failureCode: 'SUBMISSION_RESULT_UNKNOWN',
                    reason: 'SUBMISSION_RESULT_UNKNOWN',
                    approvalTransactionHash: null,
                    swapTransactionHash: null,
                })],
            }),
            ledgerPath,
        })

        await ledger.sync()

        const [event] = await readEvents(ledgerPath)
        expect(event).toMatchObject({
            event: 'needs_review',
            eventKey: 'needs_review:order-1',
            order: {
                status: 'unknown',
                failureCode: 'SUBMISSION_RESULT_UNKNOWN',
            },
            accounting: {
                estimatedRefundGasUsdMicros: null,
                refundablePaymentTokenAmountRaw: null,
            },
            refund: {
                status: 'needs-review',
                manualReviewRequired: true,
            },
        })
    })

    it('does not treat a sent row without a valid transaction hash as completed', async () => {
        const ledgerPath = await temporaryLedgerPath()
        const ledger = createManualRefundLedger({
            database: fakeDatabase({
                refunds: [refundRow({
                    refundStatus: 'sent',
                    refundTransactionHash: 'not-a-hash',
                })],
            }),
            ledgerPath,
        })

        await ledger.sync()

        const [event] = await readEvents(ledgerPath)
        expect(event.event).toBe('needs_review')
        expect(event.refund.manualReviewRequired).toBe(true)
        expect(event.refund.refundTransactionHash).toBeNull()
    })

    it('resolves relative configured paths against apps/api', () => {
        vi.stubEnv('MANUAL_REFUND_LEDGER_PATH', './data/custom-refunds.jsonl')
        expect(manualRefundLedgerInternals.configuredLedgerPath())
            .toMatch(/apps\/api\/data\/custom-refunds\.jsonl$/)
    })
})
