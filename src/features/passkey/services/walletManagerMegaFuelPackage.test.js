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

function preparedPackage(overrides = {}) {
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
    return {
        orderId: 'order-1',
        expiresAt,
        transactions: [
            'fee-payment-transfer',
            'token-approval',
            'normal-swap',
        ].map((action, index) => ({
            action,
            intentId: `intent-${index}`,
            expiresAt,
            transaction: {
                from: ADDRESS,
                to: '0x2222222222222222222222222222222222222222',
                chainId: '0x38',
                nonce: `0x${index.toString(16)}`,
                gas: '0x5208',
                gasPrice: '0x0',
                type: '0x0',
                value: '0x0',
                data: '0x1234',
            },
        })),
        ...overrides,
    }
}

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

describe('Pistachio Wallet MegaFuel package signing', () => {
    it('reviews the exact package once before invoking the one passkey gate', async () => {
        const manager = fakeManager({ phase: 'unlocked' })
        const result = await methods.signMegaFuelPackage.call(manager, preparedPackage())

        expect(manager.reviewQueue.request).toHaveBeenCalledTimes(1)
        expect(manager.ensureUnlockedForSigning).toHaveBeenCalledTimes(1)
        expect(manager.reauthenticate).not.toHaveBeenCalled()
        expect(manager.reviewQueue.request.mock.invocationCallOrder[0])
            .toBeLessThan(manager.ensureUnlockedForSigning.mock.invocationCallOrder[0])
        expect(manager.client.request).toHaveBeenCalledTimes(3)
        expect(result.signedTransactions.map((item) => item.action)).toEqual([
            'fee-payment-transfer',
            'token-approval',
            'normal-swap',
        ])
    })

    it('uses the saved session address for review before a resumed-session passkey unlock', async () => {
        const manager = fakeManager({ phase: 'locked' })
        await methods.signMegaFuelPackage.call(manager, preparedPackage())

        expect(manager.reviewQueue.request).toHaveBeenCalledWith(expect.objectContaining({
            walletAddress: ADDRESS,
            action: 'Confirm Gas Assist swap',
        }))
        expect(manager.ensureUnlockedForSigning).toHaveBeenCalledTimes(1)
        expect(manager.reauthenticate).not.toHaveBeenCalled()
        expect(manager.reviewQueue.request.mock.invocationCallOrder[0])
            .toBeLessThan(manager.ensureUnlockedForSigning.mock.invocationCallOrder[0])
    })

    it('uses the preceding bounded Gas Assist authorization without a second approval', async () => {
        const manager = fakeManager({ phase: 'unlocked' })
        manager.hasActiveGasAssistAuthorization = vi.fn(() => true)

        await methods.signMegaFuelPackage.call(manager, preparedPackage())

        expect(manager.hasActiveGasAssistAuthorization).toHaveBeenCalledOnce()
        expect(manager.reviewQueue.request).not.toHaveBeenCalled()
        expect(manager.ensureUnlockedForSigning).toHaveBeenCalledOnce()
        expect(manager.client.request).toHaveBeenCalledTimes(3)
    })

    it('rejects malformed package nonces before review or passkey prompting', async () => {
        const manager = fakeManager({ phase: 'unlocked' })
        const pkg = preparedPackage()
        pkg.transactions[2].transaction.nonce = '0x7'

        await expect(
            methods.signMegaFuelPackage.call(manager, pkg),
        ).rejects.toMatchObject({ code: 'SPONSORSHIP_PACKAGE_NONCE_MISMATCH' })
        expect(manager.reviewQueue.request).not.toHaveBeenCalled()
        expect(manager.ensureUnlockedForSigning).not.toHaveBeenCalled()
        expect(manager.client.request).not.toHaveBeenCalled()
    })

    it('rejects oversized packages before review or passkey prompting', async () => {
        const manager = fakeManager({ phase: 'unlocked' })
        const pkg = preparedPackage()
        pkg.transactions[2].transaction.data = `0x${'aa'.repeat(300_000)}`

        await expect(
            methods.signMegaFuelPackage.call(manager, pkg),
        ).rejects.toMatchObject({ code: 'PISTACHIO_REQUEST_TOO_LARGE' })
        expect(manager.reviewQueue.request).not.toHaveBeenCalled()
        expect(manager.ensureUnlockedForSigning).not.toHaveBeenCalled()
    })

    it('aborts if the active wallet changes after review and passkey authorization', async () => {
        const manager = fakeManager({ phase: 'unlocked' })
        manager.captureSigningContext.mockReturnValue({
            address: '0x9999999999999999999999999999999999999999',
            chainId: 56,
            generation: 2,
        })

        await expect(
            methods.signMegaFuelPackage.call(manager, preparedPackage()),
        ).rejects.toMatchObject({ code: 'PISTACHIO_SIGNING_CONTEXT_CHANGED' })
        expect(manager.reviewQueue.request).toHaveBeenCalledTimes(1)
        expect(manager.ensureUnlockedForSigning).toHaveBeenCalledTimes(1)
        expect(manager.client.request).not.toHaveBeenCalled()
    })
})

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
            feeRecipient: '0x2941909551c7cefd9ebeb1c5200d8b614cf887ca',
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
                purpose: expect.stringMatching(/Gas Assist fee is already in the quote/i),
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
})
