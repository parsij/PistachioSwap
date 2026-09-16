import { afterEach, describe, expect, it, vi } from 'vitest'

const particleMocks = vi.hoisted(() => ({
    signPreparedAtomicSponsoredTransaction: vi.fn(),
}))

vi.mock('./particleTransactionSigning.js', () => ({
    signPreparedAtomicSponsoredTransaction: particleMocks.signPreparedAtomicSponsoredTransaction,
}))

import {
    rawTransactionSigningInternals,
    signPreparedAtomicSponsoredTransaction,
} from './rawTransactionSigning.js'

function deferred() {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    particleMocks.signPreparedAtomicSponsoredTransaction.mockReset()
})

describe('Particle paymaster handshake', () => {
    it('does not deadlock waiting for a webhook that can be triggered by sendTransaction', async () => {
        vi.useFakeTimers()
        const approval = deferred()
        const approvalGate = vi.fn(() => approval.promise)
        particleMocks.signPreparedAtomicSponsoredTransaction.mockResolvedValue({
            provider: 'particle',
            transactionId: 'particle-1',
        })

        const resultPromise = signPreparedAtomicSponsoredTransaction({
            waitForPaymasterApproval: approvalGate,
        })

        await vi.advanceTimersByTimeAsync(rawTransactionSigningInternals.PARTICLE_PAYMASTER_PREFLIGHT_GRACE_MS)

        expect(approvalGate).toHaveBeenCalledExactlyOnceWith(null)
        expect(particleMocks.signPreparedAtomicSponsoredTransaction).toHaveBeenCalledOnce()
        const forwarded = particleMocks.signPreparedAtomicSponsoredTransaction.mock.calls[0][0]
        await expect(forwarded.waitForPaymasterApproval()).resolves.toMatchObject({
            atomicExecution: { paymasterApproval: 'pending' },
        })

        approval.resolve({ atomicExecution: { paymasterApproval: 'approved' } })
        await expect(resultPromise).resolves.toEqual({
            provider: 'particle',
            transactionId: 'particle-1',
        })
    })

    it('still fails before Particle execution when policy rejection is already known', async () => {
        const rejection = Object.assign(new Error('Policy rejected'), {
            code: 'PARTICLE_SPONSORSHIP_REJECTED',
        })
        const approvalGate = vi.fn().mockRejectedValue(rejection)

        await expect(signPreparedAtomicSponsoredTransaction({
            waitForPaymasterApproval: approvalGate,
        })).rejects.toBe(rejection)

        expect(particleMocks.signPreparedAtomicSponsoredTransaction).not.toHaveBeenCalled()
    })
})
