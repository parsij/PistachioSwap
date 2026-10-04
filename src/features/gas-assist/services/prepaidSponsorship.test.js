import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    createSponsorshipOrder,
    fetchSponsorshipConfig,
    prepaidSponsorshipInternals,
} from './prepaidSponsorship.js'

afterEach(() => {
    vi.restoreAllMocks()
    prepaidSponsorshipInternals.clearSessions()
    prepaidSponsorshipInternals.clearOrderPolls()
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

    it.each([1,10,56,100,130,137,8453,34443,42161,42220,59144,80094,534352])('requests authoritative config for source chain %s', async (chainId) => {
        const config = { enabled: true, chainId, provider: 'pistachio-paymaster-v08', execution: 'erc4337-v08-eip7702-direct' }
        const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(config)))
        await expect(fetchSponsorshipConfig('http://localhost:3001/v1/quote', undefined, chainId)).resolves.toEqual(config)
        expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('sourceChainId')).toBe(String(chainId))
    })
})
