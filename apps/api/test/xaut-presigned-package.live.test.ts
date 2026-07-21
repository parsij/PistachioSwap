import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'
import { formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { createApp } from '../src/app.js'
import { createPrepaidChainClient } from '../src/gas-assist/prepaid/chain-client.js'
import { getSponsorshipTokenEvidence } from '../src/gas-assist/prepaid/token-evidence.js'
// The live canary intentionally uses the same signing orchestration as the UI.
// @ts-ignore JavaScript frontend module imported by an opt-in Vitest canary.
import { signPreparedSponsoredPackage } from '../../../src/features/gas-assist/services/rawTransactionSigning.js'

const XAUT = '0x21caef8a43163eea865baee23b9c2e327696a3bf' as const
const RUN = process.env.RUN_XAUT_PRESIGNED_CANARY === 'true'
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
        } finally {
            await app.close()
        }
    }, LIVE_TIMEOUT_MS)
})
