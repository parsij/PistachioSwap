import { keccak256 } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    createSponsorshipOrder,
    fetchSponsorshipConfig,
    prepaidSponsorshipInternals,
    submitAtomicSponsorship,
} from './prepaidSponsorship.js'

afterEach(() => {
    vi.restoreAllMocks()
    prepaidSponsorshipInternals.clearSessions()
})

describe('prepaid sponsorship frontend trust boundary', () => {
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

    it('maps Cloudflare HTML timeouts to a retryable gateway error', async () => {
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

    it('registers only the tx hash with the backend before sending raw bytes to MegaFuel', async () => {
        const signedRawTransaction = '0x01'
        const expectedHash = keccak256(signedRawTransaction).toLowerCase()
        const calls = []
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
            calls.push({ url: String(url), options })
            const pathname = new URL(String(url)).pathname
            if (pathname.endsWith('/atomic/authorize-direct')) {
                expect(JSON.parse(String(options.body))).toEqual({
                    transactionHash: expectedHash,
                })
                return new Response(JSON.stringify({
                    mode: 'wallet-direct-megafuel',
                    orderId: 'order-1',
                    intentId: 'intent-1',
                    rpcUrl: 'https://bsc-megafuel.nodereal.io/',
                    expiresAt: new Date(Date.now() + 60_000).toISOString(),
                    transactionHash: expectedHash,
                }), { status: 200 })
            }
            if (String(url) === 'https://bsc-megafuel.nodereal.io/') {
                return new Response(JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    result: expectedHash,
                }), { status: 200 })
            }
            if (pathname.endsWith('/atomic/confirm-direct')) {
                return new Response(JSON.stringify({
                    execution: 'atomic',
                    submission: 'wallet-direct-megafuel',
                    status: 'submitted',
                    transactionHash: expectedHash,
                    intentId: 'intent-1',
                }), { status: 200 })
            }
            throw new Error(`Unexpected request: ${String(url)}`)
        })

        await expect(submitAtomicSponsorship(
            'http://localhost:3001/v1/quote',
            'session-token',
            'order-1',
            signedRawTransaction,
        )).resolves.toMatchObject({
            status: 'submitted',
            transactionHash: expectedHash,
        })

        expect(calls).toHaveLength(3)
        const backendCalls = calls.filter(({ url }) =>
            new URL(url).hostname !== 'bsc-megafuel.nodereal.io')
        expect(backendCalls).toHaveLength(2)
        for (const call of backendCalls) {
            expect(String(call.options.body ?? '')).not.toContain(signedRawTransaction)
            expect(String(call.options.body ?? '')).not.toContain('signedRawTransaction')
        }
        expect(JSON.parse(String(backendCalls[0].options.body))).toEqual({
            transactionHash: expectedHash,
        })
        const directBody = JSON.parse(String(calls[1].options.body))
        expect(directBody).toEqual({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_sendRawTransaction',
            params: [signedRawTransaction],
        })
        expect(JSON.parse(String(backendCalls[1].options.body))).toEqual({
            transactionHash: expectedHash,
        })
    })

    it('rejects a backend-selected MegaFuel host outside the official public endpoint', () => {
        expect(() => prepaidSponsorshipInternals.normalizeDirectMegaFuelRpc(
            'https://example.com/megafuel',
        )).toThrow(/untrusted direct MegaFuel endpoint/)
    })
})
