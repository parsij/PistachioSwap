import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    fetchSponsorshipOrder,
    prepaidSponsorshipInternals,
} from './particleSponsorship.js'

const endpoint = 'http://localhost:3001/v1/quote'
const sessionToken = 'session-token'
const orderId = 'order-1'

function orderPayload(overrides = {}) {
    return {
        id: orderId,
        status: 'atomic-prepared',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        atomicExecution: {
            provider: 'particle',
            execution: 'particle-universal-7702-direct',
            stage: 'paymaster-pending',
            paymasterApproval: 'pending',
            providerStatus: 'awaiting-paymaster-webhook',
        },
        ...overrides,
    }
}

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    prepaidSponsorshipInternals.clearOrderPolls()
    prepaidSponsorshipInternals.clearDirectResults()
})

describe('Particle sponsorship order polling', () => {
    it('coalesces concurrent callers and reuses the result during the minimum poll interval', async () => {
        let resolveFetch
        const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((resolve) => {
            resolveFetch = () => resolve(new Response(JSON.stringify(orderPayload()), { status: 200 }))
        }))

        const first = fetchSponsorshipOrder(endpoint, sessionToken, orderId)
        const second = fetchSponsorshipOrder(endpoint, sessionToken, orderId)

        expect(fetcher).toHaveBeenCalledTimes(1)
        resolveFetch()
        await expect(Promise.all([first, second])).resolves.toHaveLength(2)

        await expect(fetchSponsorshipOrder(endpoint, sessionToken, orderId))
            .resolves.toMatchObject({ id: orderId, status: 'atomic-prepared' })
        expect(fetcher).toHaveBeenCalledTimes(1)
        expect(prepaidSponsorshipInternals.SPONSORSHIP_ORDER_MIN_POLL_MS).toBe(5_000)
    })

    it('keeps the last safe order and backs off after a 429 instead of hammering the API', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-09-16T23:00:00.000Z'))

        const fetcher = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(JSON.stringify(orderPayload()), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                error: { code: 'RATE_LIMITED', message: 'Too many requests.' },
            }), {
                status: 429,
                headers: { 'retry-after': '8' },
            }))

        await fetchSponsorshipOrder(endpoint, sessionToken, orderId)
        expect(fetcher).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(prepaidSponsorshipInternals.SPONSORSHIP_ORDER_MIN_POLL_MS + 1)
        await expect(fetchSponsorshipOrder(endpoint, sessionToken, orderId))
            .resolves.toMatchObject({ id: orderId, status: 'atomic-prepared' })
        expect(fetcher).toHaveBeenCalledTimes(2)

        vi.advanceTimersByTime(8_000)
        await fetchSponsorshipOrder(endpoint, sessionToken, orderId)
        expect(fetcher).toHaveBeenCalledTimes(2)
        expect(prepaidSponsorshipInternals.SPONSORSHIP_ORDER_RATE_LIMIT_BACKOFF_MS).toBe(15_000)
    })
})
