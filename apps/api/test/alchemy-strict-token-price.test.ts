import { afterEach, describe, expect, it, vi } from 'vitest'

import { getTokenPrices } from '../src/providers/alchemy/token-prices.js'

const token = '0x0000000000000000000000000000000000000056'

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('strict Alchemy token pricing', () => {
    it('does not negative-cache a transient provider failure', async () => {
        vi.stubEnv('ALCHEMY_API_KEY', 'test-only-key')
        const temporaryFailure = () => new Response(
            JSON.stringify({ message: 'temporarily unavailable' }),
            { status: 503, headers: { 'content-type': 'application/json' } },
        )
        const success = new Response(JSON.stringify({
            data: [{
                address: token,
                prices: [{ currency: 'usd', value: '4000.25' }],
            }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
        const fetchMock = vi.fn()
            .mockImplementationOnce(temporaryFailure)
            .mockImplementationOnce(temporaryFailure)
            .mockImplementationOnce(temporaryFailure)
            .mockResolvedValueOnce(success)
        vi.stubGlobal('fetch', fetchMock)

        await expect(getTokenPrices({
            addresses: [token],
            requireProviderSuccess: true,
        })).rejects.toMatchObject({
            code: 'TRUSTED_PRICE_PROVIDER_UNAVAILABLE',
            retryable: true,
        })

        await expect(getTokenPrices({
            addresses: [token],
            requireProviderSuccess: true,
        })).resolves.toEqual(new Map([[token, '4000.25']]))
        expect(fetchMock).toHaveBeenCalledTimes(4)
    })
})
