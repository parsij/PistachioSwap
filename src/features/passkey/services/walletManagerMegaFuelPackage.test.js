import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./transactionValidation.js', () => ({
    describeTransactionReview: (transaction) => ({
        to: transaction.to,
        nonce: transaction.nonce,
    }),
    validateLocallySignedTransaction: vi.fn(async () => undefined),
}))

vi.mock('../../gas-assist/services/metamaskMultichain.js', () => ({
    normalizePreparedSponsoredTransaction: (transaction) => ({ ...transaction }),
    validateSignedPreparedTransaction: vi.fn(async () => undefined),
    normalizePreparedAtomicTransaction: (transaction) => ({ ...transaction }),
    validateSignedAtomicTransaction: vi.fn(async () => undefined),
}))

import { methods } from './walletManagerMegaFuelPackage.js'

const ADDRESS = '0x1111111111111111111111111111111111111111'

function fakeManager({ phase = 'unlocked' } = {}) {
    let signed = 0
    return {
        phase,
        address: phase === 'unlocked' ? ADDRESS : null,
        sessionActive: true,
        vault: { address: ADDRESS },
        ensureUnlockedForSigning: vi.fn(async function ensure() {
            this.phase = 'unlocked'
            this.address = ADDRESS
        }),
        captureSigningContext: vi.fn(() => ({
            address: ADDRESS,
            chainId: 56,
            generation: 1,
        })),
        assertSigningContext: vi.fn(),
        reauthenticate: vi.fn(async () => true),
        recordActivity: vi.fn(async () => undefined),
        reviewQueue: { request: vi.fn(async () => undefined) },
        client: {
            request: vi.fn(async () => ({
                signedTransaction: `0x${String(++signed).padStart(2, '0')}`,
            })),
        },
    }
}

beforeEach(() => vi.restoreAllMocks())

describe('Pistachio Wallet atomic MegaFuel signing', () => {
    function preparedAtomic(overrides = {}) {
        return {
            orderId: 'order-1',
            execution: 'atomic',
            action: 'atomic-swap',
            chainId: 56,
            mode: 'eip7702',
            expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
            intentId: 'intent-atomic',
            feeRecipient: '0xdeb1aff34182fb0d5f8cd87484ebb2c761547d9d',
            paymentAmountRaw: '1000',
            minOutRaw: '50',
            recipient: ADDRESS,
            transaction: {
                type: '0x4',
                chainId: '0x38',
                from: ADDRESS,
                to: ADDRESS,
                nonce: '0x1',
                gas: '0x61a80',
                maxFeePerGas: '0x0',
                maxPriorityFeePerGas: '0x0',
                value: '0x0',
                data: '0x1234',
                authorizationList: [{
                    chainId: '0x38',
                    address: '0x2222222222222222222222222222222222222222',
                    nonce: '0x2',
                }],
            },
            ...overrides,
        }
    }

    it('reviews once, signs one transaction, and does not request a package', async () => {
        const manager = fakeManager()
        const result = await methods.signAtomicMegaFuel.call(manager, preparedAtomic())
        expect(manager.reviewQueue.request).toHaveBeenCalledTimes(1)
        expect(manager.reviewQueue.request).toHaveBeenCalledWith(expect.objectContaining({
            action: 'Confirm Gas Assist swap',
            payload: expect.objectContaining({
                purpose: expect.stringMatching(/fee is paid directly to PistachioSwap/i),
            }),
        }))
        expect(manager.ensureUnlockedForSigning).toHaveBeenCalledTimes(1)
        expect(manager.client.request).toHaveBeenCalledTimes(1)
        expect(result).toMatchObject({
            orderId: 'order-1',
            intentId: 'intent-atomic',
            signedRawTransaction: '0x01',
        })
    })

    it('rejects a non-BNB-Chain atomic payload before review', async () => {
        const manager = fakeManager()
        await expect(
            methods.signAtomicMegaFuel.call(manager, preparedAtomic({ chainId: 1 })),
        ).rejects.toMatchObject({ code: 'PISTACHIO_CHAIN_INVARIANT_FAILED' })
        expect(manager.reviewQueue.request).not.toHaveBeenCalled()
        expect(manager.client.request).not.toHaveBeenCalled()
    })

    it('rejects the removed pull-executor mode before review', async () => {
        const manager = fakeManager()
        await expect(
            methods.signAtomicMegaFuel.call(manager, preparedAtomic({ mode: 'pull-executor' })),
        ).rejects.toMatchObject({ code: 'SPONSORSHIP_PACKAGE_INVALID' })
        expect(manager.reviewQueue.request).not.toHaveBeenCalled()
        expect(manager.client.request).not.toHaveBeenCalled()
    })
})
