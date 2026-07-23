import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    createPaymasterClient,
    paymasterInternals,
} from '../src/gas-assist/paymaster.js'

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
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete process.env.MEGAFUEL_REQUEST_TIMEOUT_MS
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

    it('does not inherit an undersized general provider timeout', () => {
        expect(paymasterInternals.prepaidRequestTimeoutMs(3_000)).toBe(15_000)
        expect(paymasterInternals.prepaidRequestTimeoutMs(20_000)).toBe(20_000)

        process.env.MEGAFUEL_REQUEST_TIMEOUT_MS = '25000'
        expect(paymasterInternals.prepaidRequestTimeoutMs(3_000)).toBe(25_000)
    })

    it('retries a timed-out private RPC and returns a typed timeout error', async () => {
        vi.useFakeTimers()
        const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    const error = new Error('request aborted')
                    error.name = 'AbortError'
                    reject(error)
                }, { once: true })
            }))
        const client = createPaymasterClient(fetcher as typeof fetch, () => ({
            ...privateConnection(),
            requestTimeoutMs: 10,
            sponsorabilityMethods: ['pm_isSponsorable'] as const,
        }))

        const assertion = expect(client.isSponsorable(transaction)).rejects.toMatchObject({
            code: 'PAYMASTER_TIMEOUT',
            statusCode: 504,
            details: {
                rpcMethod: 'pm_isSponsorable',
                attempts: 3,
                requestTimeoutMs: 10,
            },
        })

        await vi.runAllTimersAsync()
        await assertion
        expect(fetcher).toHaveBeenCalledTimes(3)
    })
})
