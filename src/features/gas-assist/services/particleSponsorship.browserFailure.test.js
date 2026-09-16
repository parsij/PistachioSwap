import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    prepaidSponsorshipInternals,
    recordParticleBrowserFailure,
    waitForParticlePaymasterApproval,
} from './particleSponsorship.js'

afterEach(() => {
    prepaidSponsorshipInternals.clearDirectResults()
    vi.restoreAllMocks()
})

describe('Particle browser failure cleanup', () => {
    it('stops the paymaster waiter before another order request after browser execution fails', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch')
        recordParticleBrowserFailure('order-1', {
            code: 'PARTICLE_AUTHORIZATION_INVALID',
        })

        await expect(waitForParticlePaymasterApproval(
            '/v1/quote',
            'session',
            'order-1',
            new Date(Date.now() + 60_000).toISOString(),
        )).rejects.toMatchObject({
            code: 'PARTICLE_AUTHORIZATION_INVALID',
            details: {
                stage: 'particle.paymaster-approval',
            },
        })

        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('clears stale browser failure state when a new atomic prepare begins', async () => {
        recordParticleBrowserFailure('order-1', {
            code: 'PARTICLE_AUTHORIZATION_INVALID',
        })
        const expiresAt = new Date(Date.now() + 60_000).toISOString()
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            provider: 'particle',
            execution: 'particle-universal-7702-direct',
            chainId: 56,
            orderId: 'order-1',
            stage: 'direct',
            paymentMode: 'sponsored',
            expiresAt,
            transactions: Array.from({ length: 5 }, (_, index) => ({
                to: `0x${String(index + 10).padStart(40, '0')}`,
                data: '0x',
                value: '0',
            })),
            paymasterApproval: 'pending',
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }))

        const { prepareAtomicSponsorship } = await import('./particleSponsorship.js')
        await prepareAtomicSponsorship('/v1/quote', 'session', 'order-1')

        expect(prepaidSponsorshipInternals.activeParticleBrowserFailure('order-1')).toBeNull()
    })
})
