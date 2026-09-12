import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    createSponsorshipOrder,
    fetchSponsorshipConfig,
    prepareAtomicSponsorship,
    prepaidSponsorshipInternals,
    submitAtomicSponsorship,
} from './prepaidSponsorship.js'

function particlePrepared(overrides = {}) {
    const calls = Array.from({ length: 5 }, (_, index) => ({
        to: `0x${String(index + 1).padStart(40, '0')}`,
        data: index === 3 ? '0x12345678' : '0x',
        value: '0x0',
    }))
    return {
        provider: 'particle',
        execution: 'particle-universal-7702-direct',
        stage: 'direct',
        paymentMode: 'sponsored',
        paymasterApproval: 'pending',
        orderId: 'order-1',
        chainId: 56,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        transactions: calls,
        ...overrides,
    }
}

afterEach(() => {
    vi.restoreAllMocks()
    prepaidSponsorshipInternals.clearSessions()
    prepaidSponsorshipInternals.clearDirectResults()
})

describe('Gas Assist frontend trust boundary', () => {
    it.each(['paymentToken', 'spender', 'router', 'calldata', 'gasLimit', 'projectKey'])(
        'rejects frontend field %s',
        async (field) => {
            const fetcher = vi.spyOn(globalThis, 'fetch')
            expect(() => createSponsorshipOrder(
                'http://localhost:3001/v1/quote',
                'session',
                {
                    sellToken: '0x1111111111111111111111111111111111111111',
                    buyToken: 'native',
                    grossInputAmount: '100',
                    slippageBps: 50,
                    [field]: 'injected',
                },
                'test-order-1',
            )).toThrow(/unsupported or missing fields/)
            expect(fetcher).not.toHaveBeenCalled()
        },
    )

    it('requires an idempotency key before making an order request', () => {
        const fetcher = vi.spyOn(globalThis, 'fetch')
        expect(() => createSponsorshipOrder(
            'http://localhost:3001/v1/quote',
            'session',
            {
                sellToken: '0x1111111111111111111111111111111111111111',
                buyToken: 'native',
                grossInputAmount: '100',
                slippageBps: 50,
            },
            '',
        )).toThrow(/idempotency key is required/)
        expect(fetcher).not.toHaveBeenCalled()
    })

    it('preserves backend error code, status, request ID, and stage', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            error: { code: 'SPONSORED_ROUTE_UNAVAILABLE', message: 'No safe route was found.' },
        }), {
            status: 409,
            headers: { 'x-request-id': 'request-123' },
        }))

        await expect(fetchSponsorshipConfig('http://localhost:3001/v1/quote'))
            .rejects.toMatchObject({
                code: 'SPONSORED_ROUTE_UNAVAILABLE',
                status: 409,
                requestId: 'request-123',
                stage: 'config.fetch',
            })
    })

    it('normalizes enabled config to the browser-direct Particle path', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            enabled: true,
            chainId: 56,
            atomicExecution: false,
        }), { status: 200 }))

        await expect(fetchSponsorshipConfig('http://localhost:3001/v1/quote'))
            .resolves.toMatchObject({
                enabled: true,
                provider: 'particle',
                atomicExecution: true,
                execution: 'browser-direct',
            })
    })

    it('accepts only an exact five-call direct Particle intent', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
            JSON.stringify(particlePrepared()),
            { status: 200 },
        ))
        await expect(prepareAtomicSponsorship(
            'http://localhost:3001/v1/quote',
            'session-token',
            'order-1',
        )).resolves.toMatchObject({
            stage: 'direct',
            execution: 'particle-universal-7702-direct',
            transactions: expect.arrayContaining([expect.objectContaining({ value: '0x0' })]),
        })

        vi.restoreAllMocks()
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
            JSON.stringify(particlePrepared({ transactions: particlePrepared().transactions.slice(0, 4) })),
            { status: 200 },
        ))
        await expect(prepareAtomicSponsorship(
            'http://localhost:3001/v1/quote',
            'session-token',
            'order-1',
        )).rejects.toMatchObject({ code: 'PARTICLE_DIRECT_INTENT_INVALID' })
    })

    it('never posts an owner signature or signed transaction to the backend', async () => {
        const calls = []
        const expiresAt = new Date(Date.now() + 60_000).toISOString()
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
            calls.push({ url: String(url), options })
            return new Response(JSON.stringify({
                id: 'order-1',
                status: 'atomic-prepared',
                expiresAt,
                atomicExecution: {
                    provider: 'particle',
                    stage: 'prepared',
                    paymasterApproval: 'approved',
                },
            }), { status: 200 })
        })

        await expect(submitAtomicSponsorship(
            'http://localhost:3001/v1/quote',
            'session-token',
            'order-1',
            `0x${'11'.repeat(65)}`,
        )).resolves.toMatchObject({ atomicExecution: { paymasterApproval: 'approved' } })

        expect(calls.length).toBeGreaterThan(0)
        expect(calls.every(({ url, options }) => (
            new URL(url).pathname.endsWith('/v1/sponsorship/orders/order-1') &&
            String(options.method ?? 'GET').toUpperCase() === 'GET'
        ))).toBe(true)
        expect(JSON.stringify(calls)).not.toContain('/atomic/submit')
        expect(JSON.stringify(calls)).not.toContain('/atomic/delegate')
        expect(JSON.stringify(calls)).not.toContain('1111111111111111')
    })
})
