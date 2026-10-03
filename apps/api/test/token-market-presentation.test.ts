import Fastify from 'fastify'
import { expect, it, vi } from 'vitest'
import { createTokenDetailsRoutes } from '../src/modules/token-details.js'
const address = '0x1111111111111111111111111111111111111111'
const lookup = async () => ({ address, coinGeckoId: 'example', name: 'Example', symbol: 'EX' })
it('serves real provider candles on demand and sanitizes public token information', async () => {
    const request = vi.fn(async (path: string) => path.includes('/ohlc?')
        ? [[2000, 2, 4, 1, 3], [3000, 2, 1, 1, 3], [4000, 2, 4, null, 3]]
        : path.includes('market_chart') ? { prices: [[1000, 2], [2000, 3]] }
            : { description: { en: '<p>Real description</p>' }, links: { homepage: ['https://example.org', 'javascript:alert(1)', 'https://user:secret@example.org'] }, market_data: {} })
    const app = Fastify()
    await app.register(createTokenDetailsRoutes(lookup as never, request as never))
    try {
        const url = `/v1/token-details/market?chainId=56&address=${address}`
        const response = await app.inject(url + '&chartStyle=candles')
        expect(response.json()).toMatchObject({ about: 'Real description', websites: ['https://example.org/'], chart: { candles: [{ timestamp: 2000, open: 2, high: 4, low: 1, close: 3 }] } })
        expect((await app.inject(url + '&chartStyle=fake')).statusCode).toBe(400)
        request.mockClear()
        await app.inject(url)
        expect(request.mock.calls.some(([path]) => path.includes('/ohlc?'))).toBe(false)
    } finally { await app.close() }
})
it('matches volume timestamps, prefers spot price, and retains null stats', async () => {
    const request = vi.fn(async (path: string) => path.includes('market_chart')
        ? { prices: [[3000, 3], [1000, null], [2000, 2]], total_volumes: [[2000, 200], [3000, null]] }
        : { market_data: { current_price: { usd: 4 }, market_cap: { usd: null } } })
    const app = Fastify()
    await app.register(createTokenDetailsRoutes(lookup as never, request as never))
    try {
        const response = await app.inject(`/v1/token-details/market?chainId=56&address=${address}`)
        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({ currentPriceUsd: 4, stats: { marketCapUsd: null }, chart: { points: [
            { timestamp: 2000, priceUsd: 2, volumeUsd: 200 }, { timestamp: 3000, priceUsd: 3, volumeUsd: null },
        ] } })
        expect((await app.inject(`/v1/token-details/market?chainId=56&address=${address}&period=TOSTRING`)).statusCode).toBe(400)
    } finally { await app.close() }
})
it('uses the full history supported by the Demo provider for All', async () => {
    const now = Date.now()
    const request = vi.fn(async (path: string) => path.includes('days=max')
        ? { prices: [[now - 700 * 86400000, 999], [now, 10]] }
        : path.includes('days=365') ? { prices: [[now - 10 * 86400000, 5], [now, 10]] }
            : { market_data: {} })
    const app = Fastify()
    await app.register(createTokenDetailsRoutes(lookup as never, request as never))
    try {
        const response = await app.inject(`/v1/token-details/market?chainId=56&address=${address}&period=ALL&includeYearStats=true`)
        expect(response.json().stats).toMatchObject({ high52wUsd: 10, low52wUsd: 5 }); expect(response.json().chart).toMatchObject({ period: 'ALL', historyLimitDays: 365 }); expect(request.mock.calls.every(([path]) => !path.includes('days=max'))).toBe(true)
        expect(request).toHaveBeenCalledWith(expect.stringContaining('days=365'), expect.anything())
    } finally { await app.close() }
})
