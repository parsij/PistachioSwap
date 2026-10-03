// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest'

import { fetchTokenMarketDetails } from './tokenDetails.js'

afterEach(() => {
    vi.unstubAllGlobals()
})

it('fetches internal token market data for the requested chart period', async () => {
    const fetchMock = vi.fn(async (url) => {
        const parsed = new URL(String(url))
        expect(parsed.pathname).toBe('/api/v1/token-details/market')
        expect(parsed.searchParams.get('chainId')).toBe('56')
        expect(parsed.searchParams.get('address'))
            .toBe('0x0000000000000000000000000000000000000001')
        expect(parsed.searchParams.get('period')).toBe('1D')
        expect(parsed.searchParams.get('includeYearStats')).toBe('true')
        return new Response(JSON.stringify({
            schemaVersion: 1,
            chainId: 56,
            address: '0x0000000000000000000000000000000000000001',
            chart: {
                period: '1D',
                points: [{ timestamp: 1, priceUsd: 2, volumeUsd: 3 }],
            },
            stats: {},
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchTokenMarketDetails({
        chainId: 56,
        address: '0x0000000000000000000000000000000000000001',
    }, {
        period: '1D',
        includeYearStats: true,
    })

    expect(result.chart.points).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledOnce()
})
