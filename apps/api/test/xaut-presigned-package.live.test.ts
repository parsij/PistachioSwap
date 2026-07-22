import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'
import { formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { createApp } from '../src/app.js'
import { getPool } from '../src/db/client.js'
import { createPrepaidChainClient } from '../src/gas-assist/prepaid/chain-client.js'
import { getSponsorshipTokenEvidence } from '../src/gas-assist/prepaid/token-evidence.js'
// The live canary intentionally uses the same signing orchestration as the UI.
// @ts-ignore JavaScript frontend module imported by an opt-in Vitest canary.
import { signPreparedSponsoredPackage } from '../../../src/features/gas-assist/services/rawTransactionSigning.js'

const XAUT = '0x21caef8a43163eea865baee23b9c2e327696a3bf' as const
const RUN = process.env.RUN_XAUT_PRESIGNED_CANARY === 'true'
const EXPIRE_AFTER_ERROR = process.env.EXPIRE_AFTER_ERROR === 'true'
const LIVE_TIMEOUT_MS = 16 * 60 * 1_000

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

        const unsafeIntentResult = await client.query<{ count: string }>(
            `SELECT count(*)::text AS count
             FROM sponsorship_transaction_intents
             WHERE order_id=$1
               AND (
                 signed_raw_transaction IS NOT NULL OR
                 transaction_hash IS NOT NULL OR
                 submission_attempts > 0 OR
                 status IN ('submitting','submitted','confirmed','reverted','unknown')
               )`,
            [orderId],
        )
        if (BigInt(unsafeIntentResult.rows[0]?.count ?? '0') > 0n) {
            await client.query('COMMIT')
            return { expired: false, reason: 'signed-or-broadcast-intent-exists' }
        }

        await client.query(
            `UPDATE sponsorship_transaction_intents
             SET status='expired',
                 failure_code=COALESCE(failure_code,'CANARY_ERROR_AUTO_EXPIRED'),
                 updated_at=now()
             WHERE order_id=$1
               AND status IN ('authorized','prepared','signing')
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

describe.runIf(RUN)('live XAUT -> BNB pre-signed package canary', () => {
    it('signs all three frontend transactions, stores them, and lets the backend finish', async () => {
        const account = privateKeyToAccount(requirePrivateKey())
        const expectedWallet = process.env.XAUT_TEST_WALLET_ADDRESS?.trim().toLowerCase()
        if (expectedWallet && expectedWallet !== account.address.toLowerCase()) {
            throw new Error('XAUT_TEST_WALLET_ADDRESS does not match XAUT_TEST_PRIVATE_KEY.')
        }

        const chain = createPrepaidChainClient()
        const [decimals, balance, evidence] = await Promise.all([
            chain.getTokenDecimals(XAUT),
            chain.getBalance(XAUT, account.address),
            getSponsorshipTokenEvidence(XAUT),
        ])
        expect(evidence.priceUsdMicros).not.toBeNull()
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
        await app.ready()
        try {
            const challenge = await responseJson(await app.inject({
                method: 'POST',
                url: '/v1/sponsorship/auth/challenge',
                payload: { walletAddress: account.address, chainId: 56 },
            }))
            const signature = await account.signMessage({
                message: challenge.message,
            })
            const session = await responseJson(await app.inject({
                method: 'POST',
                url: '/v1/sponsorship/auth/verify',
                payload: { challengeId: challenge.challengeId, signature },
            }))
            const authorization = `Bearer ${session.sessionToken}`

            const order = await responseJson(await app.inject({
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
            }))
            createdOrderId = String(order.id)
            const preparedPackage = await responseJson(await app.inject({
                method: 'POST',
                url: `/v1/sponsorship/orders/${order.id}/package/prepare`,
                headers: { authorization },
                payload: {},
            }))
            expect(preparedPackage.transactions.map(
                (value: { action: string }) => value.action,
            )).toEqual([
                'fee-payment-transfer',
                'token-approval',
                'normal-swap',
            ])
            expect(Date.parse(preparedPackage.expiresAt) - Date.now())
                .toBeGreaterThan(13 * 60 * 1_000)

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
            const submission = await signPreparedSponsoredPackage({
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
            })
            expect(submission.packageStored).toBe(true)

            const deadline = Date.now() + 15 * 60 * 1_000
            let current: Record<string, unknown> = order
            while (Date.now() < deadline) {
                current = await responseJson(await app.inject({
                    method: 'GET',
                    url: `/v1/sponsorship/orders/${order.id}`,
                    headers: { authorization },
                }))
                if (current.status === 'completed') break
                if (['expired', 'rejected', 'failed'].includes(String(current.status))) {
                    throw new Error(`Canary entered terminal status: ${JSON.stringify(current)}`)
                }
                await new Promise((resolve) => setTimeout(resolve, 3_000))
            }

            expect(current.status).toBe('completed')
            expect(current.paymentTransactionHash).toMatch(/^0x[0-9a-f]{64}$/)
            expect(current.approvalTransactionHash).toMatch(/^0x[0-9a-f]{64}$/)
            expect(current.swapTransactionHash).toMatch(/^0x[0-9a-f]{64}$/)
            expect(current.preSignedPackage).toBe(true)
        } catch (error) {
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
            await app.close()
        }
    }, LIVE_TIMEOUT_MS)
})
