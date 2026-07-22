import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'
import { formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { createApp } from '../src/app.js'
import { getPool } from '../src/db/client.js'
import { createPrepaidChainClient } from '../src/gas-assist/prepaid/chain-client.js'
import {
    CanarySafetyStopError,
    getCanaryPreparationConfig,
    isAmbiguousCanaryIntent,
    retryCanaryPreparation,
    trustedPriceUnavailable,
} from '../src/gas-assist/prepaid/canary-preparation.js'
import { getSponsorshipTokenEvidence } from '../src/gas-assist/prepaid/token-evidence.js'
// The live canary intentionally uses the same signing orchestration as the UI.
// @ts-ignore JavaScript frontend module imported by an opt-in Vitest canary.
import { signPreparedSponsoredPackage } from '../../../src/features/gas-assist/services/rawTransactionSigning.js'

const XAUT = '0x21caef8a43163eea865baee23b9c2e327696a3bf' as const
const RUN = process.env.RUN_XAUT_PRESIGNED_CANARY === 'true'
const EXPIRE_AFTER_ERROR = process.env.EXPIRE_AFTER_ERROR === 'true'
const LIVE_TIMEOUT_MS = 16 * 60 * 1_000

if (RUN && process.env.DEBUG_SPONSORSHIP_TRACE === undefined) {
    process.env.DEBUG_SPONSORSHIP_TRACE = 'true'
}

let stepNumber = 0

async function canaryStep<T>(
    name: string,
    operation: () => Promise<T>,
    details: Record<string, unknown> = {},
): Promise<T> {
    const number = ++stepNumber
    const startedAt = Date.now()
    console.warn(`[xaut-canary-step-${number}.start]`, { name, ...details })
    try {
        const result = await operation()
        console.warn(`[xaut-canary-step-${number}.success]`, {
            name,
            elapsedMs: Date.now() - startedAt,
        })
        return result
    } catch (error) {
        console.error(`[xaut-canary-step-${number}.error]`, {
            name,
            elapsedMs: Date.now() - startedAt,
            errorName: error instanceof Error ? error.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error
                ? error.stack?.split('\n').slice(0, 12).join('\n')
                : undefined,
        })
        throw error
    }
}

function requirePrivateKey() {
    const value = process.env.XAUT_TEST_PRIVATE_KEY?.trim()
    if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
        throw new Error('XAUT_TEST_PRIVATE_KEY must be a private key for the funded test wallet.')
    }
    return value as `0x${string}`
}

function ceilDiv(numerator: bigint, denominator: bigint) {
    return (numerator + denominator - 1n) / denominator
}

async function responseJson(response: { statusCode: number; body: string }) {
    const payload = JSON.parse(response.body)
    if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`${response.statusCode}: ${JSON.stringify(payload)}`)
    }
    return payload
}

async function expireUnsignedCanaryOrder(
    orderId: string,
    walletAddress: string,
) {
    const client = await getPool().connect()
    try {
        await client.query('BEGIN')
        const orderResult = await client.query<{
            status: string
            paymentTransactionHash: string | null
            approvalTransactionHash: string | null
            swapTransactionHash: string | null
        }>(
            `SELECT status,
                    payment_transaction_hash AS "paymentTransactionHash",
                    approval_transaction_hash AS "approvalTransactionHash",
                    swap_transaction_hash AS "swapTransactionHash"
             FROM sponsorship_orders
             WHERE id=$1 AND wallet_address=$2
             FOR UPDATE`,
            [orderId, walletAddress.toLowerCase()],
        )
        const order = orderResult.rows[0]
        if (!order || ['completed', 'expired', 'rejected', 'failed'].includes(order.status)) {
            await client.query('COMMIT')
            return { expired: false, reason: 'already-terminal-or-missing' }
        }
        if (order.paymentTransactionHash ||
            order.approvalTransactionHash ||
            order.swapTransactionHash) {
            await client.query('COMMIT')
            return { expired: false, reason: 'order-has-transaction-hash' }
        }

        const intentResult = await client.query<{
            action: string
            status: string
            nonce: string
            hasSignedRawTransaction: boolean
            transactionHash: string | null
            submissionAttempts: number
            broadcastAttempts: number
        }>(
            `SELECT action,
                    status,
                    nonce::text AS nonce,
                    (signed_raw_transaction IS NOT NULL) AS "hasSignedRawTransaction",
                    transaction_hash AS "transactionHash",
                    submission_attempts AS "submissionAttempts",
                    broadcast_attempts AS "broadcastAttempts"
             FROM sponsorship_transaction_intents
             WHERE order_id=$1
             ORDER BY nonce`,
            [orderId],
        )
        const ambiguousIntent = intentResult.rows.find(isAmbiguousCanaryIntent)
        if (ambiguousIntent) {
            await client.query('COMMIT')
            return {
                expired: false,
                reason: 'ambiguous-intent-exists',
                ambiguousIntent,
            }
        }

        await client.query(
            `UPDATE sponsorship_transaction_intents
             SET status='expired',
                 failure_code=COALESCE(failure_code,'CANARY_ERROR_AUTO_EXPIRED'),
                 updated_at=now()
             WHERE order_id=$1
               AND status IN ('authorized','prepared')
               AND signed_raw_transaction IS NULL
               AND transaction_hash IS NULL
               AND submission_attempts=0`,
            [orderId],
        )
        const expired = await client.query(
            `UPDATE sponsorship_orders
             SET status='expired',
                 rejection_code='CANARY_ERROR_AUTO_EXPIRED',
                 updated_at=now()
             WHERE id=$1
               AND wallet_address=$2
               AND status NOT IN ('completed','expired','rejected','failed')
               AND payment_transaction_hash IS NULL
               AND approval_transaction_hash IS NULL
               AND swap_transaction_hash IS NULL`,
            [orderId, walletAddress.toLowerCase()],
        )
        await client.query('COMMIT')
        return {
            expired: expired.rowCount === 1,
            reason: expired.rowCount === 1 ? 'unsigned-order-expired' : 'order-changed',
        }
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
    } finally {
        client.release()
    }
}

async function expirePreviousUnsignedCanaryOrders(walletAddress: string) {
    const result = await getPool().query<{ id: string }>(
        `SELECT id
         FROM sponsorship_orders
         WHERE wallet_address=$1
           AND idempotency_key LIKE 'xaut-live-%'
           AND status NOT IN ('completed','expired','rejected','failed')
         ORDER BY created_at`,
        [walletAddress.toLowerCase()],
    )
    for (const order of result.rows) {
        const cleanup = await expireUnsignedCanaryOrder(order.id, walletAddress)
        console.warn('[xaut-presigned-canary-preflight-expire]', {
            orderId: order.id,
            ...cleanup,
        })
        if (cleanup.reason === 'ambiguous-intent-exists' &&
            cleanup.ambiguousIntent) {
            throw new CanarySafetyStopError(
                order.id,
                cleanup.ambiguousIntent,
            )
        }
        if (!cleanup.expired && cleanup.reason !== 'already-terminal-or-missing') {
            throw new Error(
                `Canary preflight could not prove order ${order.id} safe for a new attempt: ${cleanup.reason}`,
            )
        }
    }
}

describe.runIf(RUN)('live XAUT -> BNB pre-signed package canary', () => {
    it('signs all three frontend transactions, stores them, and lets the backend finish', async () => {
        console.warn('[xaut-canary-start]', {
            expireAfterError: EXPIRE_AFTER_ERROR,
            debugSponsorshipTrace: process.env.DEBUG_SPONSORSHIP_TRACE === 'true',
            megaFuelTimeoutMs: process.env.MEGAFUEL_REQUEST_TIMEOUT_MS ?? 'default',
        })
        const account = privateKeyToAccount(requirePrivateKey())
        const expectedWallet = process.env.XAUT_TEST_WALLET_ADDRESS?.trim().toLowerCase()
        if (expectedWallet && expectedWallet !== account.address.toLowerCase()) {
            throw new Error('XAUT_TEST_WALLET_ADDRESS does not match XAUT_TEST_PRIVATE_KEY.')
        }
        if (EXPIRE_AFTER_ERROR) {
            await canaryStep(
                'expire previous unsigned canary orders',
                () => expirePreviousUnsignedCanaryOrders(account.address),
                { wallet: account.address },
            )
        }

        const chain = createPrepaidChainClient()
        const preparationConfig = getCanaryPreparationConfig()
        const [decimals, balance, evidence] = await canaryStep(
            'load XAUT decimals, balance, price, liquidity, and security evidence',
            () => retryCanaryPreparation(async (attempt) => {
                const prepared = await Promise.all([
                    chain.getTokenDecimals(XAUT),
                    chain.getBalance(XAUT, account.address),
                    getSponsorshipTokenEvidence(XAUT),
                ])
                if (prepared[2].priceUsdMicros === null) {
                    throw trustedPriceUnavailable()
                }
                console.warn('[xaut-canary-preparation-attempt-success]', {
                    retryAttempt: attempt,
                    maximumAttempts: preparationConfig.attempts,
                })
                return prepared
            }, {
                config: preparationConfig,
                onRetry: (details) => console.warn(
                    '[xaut-canary-preparation-retry]',
                    details,
                ),
            }),
            { wallet: account.address, token: XAUT },
        )
        if (evidence.priceUsdMicros === null) {
            throw trustedPriceUnavailable()
        }
        expect(evidence.liquidityUsdMicros).toBeGreaterThan(0n)
        expect(evidence.securityStatus).toBe('trusted')
        expect(evidence.transferBehavior).toBe('exact')

        const targetUsdMicros = 210_000n
        const grossInputAmount = ceilDiv(
            targetUsdMicros * 10n ** BigInt(decimals),
            evidence.priceUsdMicros!,
        )
        expect(balance).toBeGreaterThanOrEqual(grossInputAmount)
        console.warn('[xaut-presigned-canary]', {
            wallet: account.address,
            targetUsd: '0.21',
            xautAmount: formatUnits(grossInputAmount, decimals),
            liquidityUsdMicros: evidence.liquidityUsdMicros.toString(),
        })

        const app = createApp()
        let createdOrderId: string | null = null
        await canaryStep('initialize Fastify application', () => app.ready())
        try {
            const challenge = await canaryStep(
                'request wallet authentication challenge',
                async () => responseJson(await app.inject({
                    method: 'POST',
                    url: '/v1/sponsorship/auth/challenge',
                    payload: { walletAddress: account.address, chainId: 56 },
                })),
            )
            const signature = await canaryStep(
                'sign wallet authentication challenge',
                () => account.signMessage({ message: challenge.message }),
            )
            const session = await canaryStep(
                'verify wallet authentication challenge',
                async () => responseJson(await app.inject({
                    method: 'POST',
                    url: '/v1/sponsorship/auth/verify',
                    payload: { challengeId: challenge.challengeId, signature },
                })),
            )
            const authorization = `Bearer ${session.sessionToken}`

            const order = await canaryStep(
                'create reviewed sponsorship order and settlement route probe',
                async () => responseJson(await app.inject({
                    method: 'POST',
                    url: '/v1/sponsorship/orders',
                    headers: {
                        authorization,
                        'idempotency-key': `xaut-live-${randomUUID()}`,
                    },
                    payload: {
                        sellToken: XAUT,
                        buyToken: 'native',
                        grossInputAmount: grossInputAmount.toString(),
                        slippageBps: 100,
                    },
                })),
            )
            createdOrderId = String(order.id)
            console.warn('[xaut-canary-order-created]', {
                orderId: createdOrderId,
                status: order.status,
                paymentAmountRaw: order.paymentAmountRaw,
                netSwapAmountRaw: order.netSwapAmountRaw,
            })

            const preparedPackage = await canaryStep(
                'prepare fee, approval, and swap package',
                async () => responseJson(await app.inject({
                    method: 'POST',
                    url: `/v1/sponsorship/orders/${order.id}/package/prepare`,
                    headers: { authorization },
                    payload: {},
                })),
                { orderId: createdOrderId },
            )
            expect(preparedPackage.transactions.map(
                (value: { action: string }) => value.action,
            )).toEqual([
                'fee-payment-transfer',
                'token-approval',
                'normal-swap',
            ])
            expect(Date.parse(preparedPackage.expiresAt) - Date.now())
                .toBeGreaterThan(13 * 60 * 1_000)
            console.warn('[xaut-canary-package-prepared]', {
                orderId: createdOrderId,
                expiresAt: preparedPackage.expiresAt,
                transactions: preparedPackage.transactions.map((value: {
                    action: string
                    transaction: { nonce: string; to: string; gas: string }
                }) => ({
                    action: value.action,
                    nonce: value.transaction.nonce,
                    to: value.transaction.to,
                    gas: value.transaction.gas,
                })),
            })

            const walletClient = {
                async request({
                    method,
                    params,
                }: {
                    method: string
                    params: [Record<string, string>]
                }) {
                    if (method !== 'eth_signTransaction') {
                        throw new Error(`Unexpected wallet method: ${method}`)
                    }
                    const transaction = params[0]
                    console.warn('[xaut-canary-sign-transaction]', {
                        nonce: transaction.nonce,
                        to: transaction.to,
                        gas: transaction.gas,
                        dataBytes: Math.max(0, (transaction.data.length - 2) / 2),
                    })
                    return account.signTransaction({
                        chainId: Number(BigInt(transaction.chainId)),
                        type: 'legacy',
                        nonce: Number(BigInt(transaction.nonce)),
                        to: transaction.to as `0x${string}`,
                        data: transaction.data as `0x${string}`,
                        value: BigInt(transaction.value),
                        gas: BigInt(transaction.gas),
                        gasPrice: BigInt(transaction.gasPrice),
                    })
                },
            }
            const capability = {
                rawTransactionSigningSupported: true,
                method: 'eth_signTransaction',
                transport: 'pistachio-local',
            }
            const submission = await canaryStep(
                'sign all three transactions and atomically store package',
                () => signPreparedSponsoredPackage({
                    transport: 'pistachio-local',
                    capability,
                    walletClient,
                    preparedPackage,
                    authenticatedWalletAddress: account.address,
                    multichainAccount: account.address,
                    submitSignedPackage: async (signedTransactions: unknown[]) =>
                        responseJson(await app.inject({
                            method: 'POST',
                            url: `/v1/sponsorship/orders/${order.id}/package/submit`,
                            headers: { authorization },
                            payload: { signedTransactions },
                        })),
                }),
                { orderId: createdOrderId },
            )
            expect(submission.packageStored).toBe(true)

            const deadline = Date.now() + 15 * 60 * 1_000
            let current: Record<string, unknown> = order
            let previousStatus = ''
            await canaryStep('poll backend execution until completion', async () => {
                while (Date.now() < deadline) {
                    current = await responseJson(await app.inject({
                        method: 'GET',
                        url: `/v1/sponsorship/orders/${order.id}`,
                        headers: { authorization },
                    }))
                    const status = String(current.status)
                    if (status !== previousStatus) {
                        previousStatus = status
                        console.warn('[xaut-canary-status-change]', {
                            orderId: createdOrderId,
                            status,
                            currentRequiredAction: current.currentRequiredAction,
                            paymentTransactionHash: current.paymentTransactionHash,
                            approvalTransactionHash: current.approvalTransactionHash,
                            swapTransactionHash: current.swapTransactionHash,
                        })
                    }
                    if (status === 'completed') break
                    if (['expired', 'rejected', 'failed'].includes(status)) {
                        throw new Error(`Canary entered terminal status: ${JSON.stringify(current)}`)
                    }
                    await new Promise((resolve) => setTimeout(resolve, 3_000))
                }
            }, { orderId: createdOrderId })

            expect(current.status).toBe('completed')
            expect(current.paymentTransactionHash).toMatch(/^0x[0-9a-f]{64}$/)
            expect(current.approvalTransactionHash).toMatch(/^0x[0-9a-f]{64}$/)
            expect(current.swapTransactionHash).toMatch(/^0x[0-9a-f]{64}$/)
            expect(current.preSignedPackage).toBe(true)
            console.warn('[xaut-canary-completed]', {
                orderId: createdOrderId,
                paymentTransactionHash: current.paymentTransactionHash,
                approvalTransactionHash: current.approvalTransactionHash,
                swapTransactionHash: current.swapTransactionHash,
            })
        } catch (error) {
            console.error('[xaut-canary-failed]', {
                orderId: createdOrderId,
                errorName: error instanceof Error ? error.name : typeof error,
                errorMessage: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error
                    ? error.stack?.split('\n').slice(0, 16).join('\n')
                    : undefined,
            })
            if (EXPIRE_AFTER_ERROR && createdOrderId) {
                try {
                    const cleanup = await expireUnsignedCanaryOrder(
                        createdOrderId,
                        account.address,
                    )
                    console.warn('[xaut-presigned-canary-auto-expire]', {
                        orderId: createdOrderId,
                        ...cleanup,
                    })
                } catch (cleanupError) {
                    console.error('[xaut-presigned-canary-auto-expire-failed]', {
                        orderId: createdOrderId,
                        error: cleanupError instanceof Error
                            ? cleanupError.message
                            : String(cleanupError),
                    })
                }
            }
            throw error
        } finally {
            await canaryStep('close Fastify application', () => app.close())
        }
    }, LIVE_TIMEOUT_MS)
})
