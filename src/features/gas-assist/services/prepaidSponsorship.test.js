import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    createSponsorshipOrder,
    fetchSponsorshipConfig,
    prepareAtomicSponsorship,
    prepaidSponsorshipInternals,
    submitAtomicSponsorship,
} from './prepaidSponsorship.js'

const SIGNATURE = `0x${'11'.repeat(65)}`

function alchemyPrepared(overrides = {}) {
    return {
        provider: 'alchemy',
        execution: 'alchemy-wallet-api',
        stage: 'sign',
        paymentMode: 'sponsored',
        orderId: 'order-1',
        chainId: 56,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        signatureRequests: [{
            type: 'personal_sign',
            data: { raw: `0x${'22'.repeat(32)}` },
            rawPayload: `0x${'33'.repeat(32)}`,
        }],
        ...overrides,
    }
}

afterEach(() => {
    vi.restoreAllMocks()
    prepaidSponsorshipInternals.clearSessions()
})

describe('Gas Assist frontend trust boundary', () => {
    it.each(['paymentToken', 'spender', 'router', 'calldata', 'gasLimit', 'policyUuid'])(
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
                details: expect.objectContaining({
                    backendDetails: { providers: ['uniswap', '0x'] },
                }),
            })
    })

    it('maps gateway HTML timeouts to a retryable gateway error', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>502 Bad Gateway</html>', {
            status: 502,
            headers: { 'content-type': 'text/html' },
        }))

        await expect(fetchSponsorshipConfig('http://localhost:3001/v1/quote'))
            .rejects.toMatchObject({
                code: 'CROSS_CHAIN_GATEWAY_TIMEOUT',
                status: 502,
            })
    })

    it('reports malformed successful JSON responses instead of returning null', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>broken</html>', {
            status: 200,
        }))

        await expect(fetchSponsorshipConfig('http://localhost:3001/v1/quote'))
            .rejects.toMatchObject({
                code: 'SPONSORSHIP_INVALID_RESPONSE',
                stage: 'config.fetch',
            })
    })

    it('normalizes enabled server config to the Alchemy atomic client path', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            enabled: true,
            chainId: 56,
            atomicExecution: false,
        }), { status: 200 }))

        await expect(fetchSponsorshipConfig('http://localhost:3001/v1/quote'))
            .resolves.toMatchObject({
                enabled: true,
                provider: 'alchemy',
                atomicExecution: true,
            })
    })

    it('keeps the pre-op permit continuation private to the prepared object', async () => {
        const calls = []
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
            calls.push({ url: String(url), options })
            const pathname = new URL(String(url)).pathname
            if (pathname.endsWith('/atomic/prepare')) {
                return new Response(JSON.stringify(alchemyPrepared({
                    stage: 'permit-required',
                    paymentMode: 'erc20-preop',
                    signatureRequests: [{
                        type: 'eth_signTypedData_v4',
                        data: {
                            domain: { name: 'Token' },
                            types: { Permit: [{ name: 'owner', type: 'address' }] },
                            primaryType: 'Permit',
                            message: { owner: '0x1111111111111111111111111111111111111111' },
                        },
                        rawPayload: `0x${'44'.repeat(32)}`,
                    }],
                })), { status: 200 })
            }
            if (pathname.endsWith('/atomic/permit')) {
                expect(JSON.parse(String(options.body))).toEqual({ signature: SIGNATURE })
                return new Response(JSON.stringify(alchemyPrepared({
                    paymentMode: 'erc20-preop',
                })), { status: 200 })
            }
            throw new Error(`Unexpected request: ${String(url)}`)
        })

        const prepared = await prepareAtomicSponsorship(
            'http://localhost:3001/v1/quote',
            'session-token',
            'order-1',
        )
        expect(prepared.stage).toBe('permit-required')
        expect(JSON.stringify(prepared)).not.toContain('session-token')
        const continuation = prepared[prepaidSponsorshipInternals.ALCHEMY_CONTINUE_PERMIT]
        expect(typeof continuation).toBe('function')
        await expect(continuation(SIGNATURE)).resolves.toMatchObject({
            stage: 'sign',
            paymentMode: 'erc20-preop',
        })
        expect(calls).toHaveLength(2)
    })

    it('submits only Alchemy signatures to the backend', async () => {
        const calls = []
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
            calls.push({ url: String(url), options })
            return new Response(JSON.stringify({
                provider: 'alchemy',
                orderId: 'order-1',
                status: 'submitted',
                callId: '0x1234',
                transactionHash: null,
            }), { status: 200 })
        })

        await expect(submitAtomicSponsorship(
            'http://localhost:3001/v1/quote',
            'session-token',
            'order-1',
            [SIGNATURE],
        )).resolves.toMatchObject({
            status: 'submitted',
            callId: '0x1234',
        })

        expect(calls).toHaveLength(1)
        expect(new URL(calls[0].url).pathname).toMatch(/\/atomic\/submit$/)
        expect(JSON.parse(String(calls[0].options.body))).toEqual({
            signatures: [SIGNATURE],
        })
        expect(String(calls[0].options.body)).not.toContain('signedRawTransaction')
    })
})
