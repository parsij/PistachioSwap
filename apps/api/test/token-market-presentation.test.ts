import Fastify from 'fastify'
import { expect, it, vi } from 'vitest'
import { createTokenDetailsRoutes } from '../src/modules/token-details.js'
const address = '0x1111111111111111111111111111111111111111'
const lookup = async () => ({ address, coinGeckoId: 'example', name: 'Example', symbol: 'EX' })
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
it('does not label all-time extremes as 52-week stats', async () => {
    const now = Date.now()
    const request = vi.fn(async (path: string) => path.includes('days=max')
        ? { prices: [[now - 700 * 86400000, 999], [now, 10]] }
        : path.includes('days=365') ? { prices: [[now - 10 * 86400000, 5], [now, 10]] }
            : { market_data: {} })
    const app = Fastify()
    await app.register(createTokenDetailsRoutes(lookup as never, request as never))
    try {
        const response = await app.inject(`/v1/token-details/market?chainId=56&address=${address}&period=ALL&includeYearStats=true`)
        expect(response.json().stats).toMatchObject({ high52wUsd: 10, low52wUsd: 5 })
        expect(request).toHaveBeenCalledWith(expect.stringContaining('days=365'), expect.anything())
    } finally { await app.close() }
})
