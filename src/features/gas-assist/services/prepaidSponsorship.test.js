import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    createSponsorshipOrder,
    fetchSponsorshipConfig,
    prepareAtomicSponsorship,
    prepaidSponsorshipInternals,
    submitAtomicSponsorship,
} from './prepaidSponsorship.js'

const SIGNATURE = `0x${'11'.repeat(65)}`
const USER_OP_HASH = `0x${'22'.repeat(32)}`

function particlePrepared(overrides = {}) {
    return {
        provider: 'particle',
        execution: 'particle-paymaster-v06',
        stage: 'sign',
        paymentMode: 'sponsored',
        orderId: 'order-1',
        chainId: 56,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        signatureRequests: [{ type: 'personal_sign', data: { raw: USER_OP_HASH } }],
        signing: { method: 'personal_sign', continuation: null },
        ...overrides,
    }
}

afterEach(() => {
    vi.restoreAllMocks()
    prepaidSponsorshipInternals.clearSessions()
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

    it('preserves backend error code, stage, status, request ID, and details', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            error: {
                code: 'SPONSORED_ROUTE_UNAVAILABLE',
                message: 'No safe route was found.',
                details: { providers: ['uniswap', '0x'] },
            },
        }), {
            status: 409,
            headers: { 'x-request-id': 'request-123' },
        }))

        await expect(fetchSponsorshipConfig('http://localhost:3001/v1/quote'))
            .rejects.toMatchObject({
                code: 'SPONSORED_ROUTE_UNAVAILABLE',
                message: 'No safe route was found.',
                status: 409,
                requestId: 'request-123',
                stage: 'config.fetch',
            })
    })

    it('maps gateway HTML timeouts to a retryable gateway error', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }))
        await expect(fetchSponsorshipConfig('http://localhost:3001/v1/quote'))
            .rejects.toMatchObject({ code: 'CROSS_CHAIN_GATEWAY_TIMEOUT', status: 502 })
    })

    it('normalizes enabled server config to the Particle atomic client path', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            enabled: true,
            chainId: 56,
            atomicExecution: false,
        }), { status: 200 }))

        await expect(fetchSponsorshipConfig('http://localhost:3001/v1/quote'))
            .resolves.toMatchObject({ enabled: true, provider: 'particle', atomicExecution: true })
    })

    it('keeps the EIP-7702 delegation continuation private to the prepared object', async () => {
        const calls = []
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
            calls.push({ url: String(url), options })
            const pathname = new URL(String(url)).pathname
            if (pathname.endsWith('/atomic/prepare')) {
                return new Response(JSON.stringify(particlePrepared({
                    stage: 'delegation-required',
                    signatureRequests: [{
                        type: 'eip7702Auth',
                        rawPayload: `0x${'33'.repeat(32)}`,
                        data: {
                            address: '0x1111111111111111111111111111111111111111',
                            chainId: 56,
                            nonce: 3,
                        },
                    }],
                    signing: {
                        method: 'pistachio_signParticleAuthorization',
                        continuation: 'delegate',
                    },
                })), { status: 200 })
            }
            if (pathname.endsWith('/atomic/delegate')) {
                expect(JSON.parse(String(options.body))).toEqual({ signature: SIGNATURE })
                return new Response(JSON.stringify(particlePrepared()), { status: 200 })
            }
            throw new Error(`Unexpected request: ${String(url)}`)
        })

        const prepared = await prepareAtomicSponsorship(
            'http://localhost:3001/v1/quote',
            'session-token',
            'order-1',
        )
        expect(prepared.stage).toBe('delegation-required')
        expect(JSON.stringify(prepared)).not.toContain('session-token')
        const continuation = prepared[prepaidSponsorshipInternals.PARTICLE_CONTINUE_DELEGATION]
        expect(typeof continuation).toBe('function')
        await expect(continuation(SIGNATURE)).resolves.toMatchObject({ stage: 'sign' })
        expect(calls).toHaveLength(2)
    })

    it('submits only one Particle owner signature to the backend', async () => {
        const calls = []
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
            calls.push({ url: String(url), options })
            return new Response(JSON.stringify({
                orderId: 'order-1',
                userOperationHash: USER_OP_HASH,
                transactionHash: null,
            }), { status: 200 })
        })

        await expect(submitAtomicSponsorship(
            'http://localhost:3001/v1/quote',
            'session-token',
            'order-1',
            [SIGNATURE],
        )).resolves.toMatchObject({ userOperationHash: USER_OP_HASH })

        expect(calls).toHaveLength(1)
        expect(new URL(calls[0].url).pathname).toMatch(/\/atomic\/submit$/)
        expect(JSON.parse(String(calls[0].options.body))).toEqual({ signatures: [SIGNATURE] })
        expect(String(calls[0].options.body)).not.toContain('projectKey')
        expect(String(calls[0].options.body)).not.toContain('signedRawTransaction')
    })
})
