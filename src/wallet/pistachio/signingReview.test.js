import { describe, expect, it, vi } from 'vitest'

import { SigningReviewQueue } from './signingReview.js'

describe('Pistachio signing review queue', () => {
    it('allows one active request and requires the exact request ID', async () => {
        const queue = new SigningReviewQueue()
        const first = queue.request({ walletAddress: '0x1', chainId: 1, action: 'Sign message', payload: { message: 'test' } })
        await expect(queue.request({ walletAddress: '0x1', chainId: 1, action: 'Sign message', payload: {} })).rejects.toMatchObject({ code: 'PISTACHIO_SIGNING_REQUEST_ACTIVE' })
        expect(() => queue.approve('wrong')).toThrowError(expect.objectContaining({ code: 'PISTACHIO_SIGNING_REQUEST_STALE' }))
        queue.approve(queue.snapshot().id)
        await expect(first).resolves.toBe(true)
    })

    it('expires stale reviews and rejects pending reviews on lock', async () => {
        vi.useFakeTimers()
        try {
            const queue = new SigningReviewQueue()
            const stale = queue.request({ walletAddress: '0x1', chainId: 56, action: 'Sign transaction', payload: {} })
            const rejection = expect(stale).rejects.toMatchObject({ code: 'PISTACHIO_SIGNING_REQUEST_EXPIRED' })
            await vi.advanceTimersByTimeAsync(120_001)
            await rejection
            const pending = queue.request({ walletAddress: '0x1', chainId: 56, action: 'Sign transaction', payload: {} })
            const locked = expect(pending).rejects.toMatchObject({ code: 'PISTACHIO_WALLET_LOCKED' })
            queue.clear()
            await locked
        } finally {
            vi.useRealTimers()
        }
    })

    it('binds each immutable review snapshot to an allowlisted chain', async () => {
        const queue = new SigningReviewQueue()
        const payload = { destination: '0x1' }
        const pending = queue.request({ walletAddress: '0x1', chainId: 8453, action: 'Send transaction', payload })
        payload.destination = '0x2'

        expect(queue.snapshot()).toMatchObject({
            chainId: 8453,
            chainName: 'Base',
            payload: { destination: '0x1' },
        })
        queue.approve(queue.snapshot().id)
        await expect(pending).resolves.toBe(true)
        await expect(queue.request({ walletAddress: '0x1', chainId: 999999, action: 'Sign', payload: {} })).rejects.toMatchObject({ code: 'PISTACHIO_CHAIN_NOT_ALLOWED' })
    })
})
