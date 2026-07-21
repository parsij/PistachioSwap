import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPaymasterClient } from '../src/gas-assist/paymaster.js'

const transaction = {
    from: '0x0000000000000000000000000000000000000011',
    to: '0x0000000000000000000000000000000000000022',
    data: '0x',
    value: '0x0',
    gas: '0x124f8',
}

function privateConnection() {
    return {
        rpcUrl: 'https://paymaster.test.invalid/rpc',
        policyId: 'private-policy',
        userAgent: 'PistachioWallet/1.0',
        requestTimeoutMs: 1_000,
        sponsorabilityMethods: ['eth_isSponsorable', 'pm_isSponsorable'] as const,
    }
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('MegaFuel sponsorability method fallback', () => {
    it('falls back from eth_isSponsorable to pm_isSponsorable on method-not-found', async () => {
        const fetcher = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                error: { code: -32601, message: 'Method not found' },
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                result: { sponsorable: true },
            }), { status: 200 }))
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const client = createPaymasterClient(fetcher, privateConnection)

        await expect(client.isSponsorable(transaction)).resolves.toBe(true)

        expect(fetcher).toHaveBeenCalledTimes(2)
        expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
            method: 'eth_isSponsorable',
            params: [transaction],
        })
        expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
            method: 'pm_isSponsorable',
            params: [transaction],
        })
        expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({
            'x-megafuel-policy-uuid': 'private-policy',
        })
        expect(warning).toHaveBeenCalledWith(
            '[megafuel-sponsorability-method-fallback]',
            {
                unavailableMethod: 'eth_isSponsorable',
                fallbackMethod: 'pm_isSponsorable',
            },
        )
    })

    it('does not fall back when the supported method returns false', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: false,
        }), { status: 200 }))
        const client = createPaymasterClient(fetcher, privateConnection)

        await expect(client.isSponsorable(transaction)).resolves.toBe(false)
        expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('does not hide a real provider rejection behind the fallback', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32000, message: 'Policy rejected transaction' },
        }), { status: 200 }))
        const client = createPaymasterClient(fetcher, privateConnection)

        await expect(client.isSponsorable(transaction)).rejects.toMatchObject({
            code: 'PAYMASTER_REJECTED',
            details: {
                rpcMethod: 'eth_isSponsorable',
                providerMessage: 'Policy rejected transaction',
            },
        })
        expect(fetcher).toHaveBeenCalledTimes(1)
    })
})
