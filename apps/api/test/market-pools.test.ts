import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import {
    createMarketPoolRoutes,
    createMarketPoolService,
    extractMarketPools,
} from '../src/modules/market-pools.js'

const POOL_ADDRESS = '0x0000000000000000000000000000000000000abc'
const BASE = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
const QUOTE = '0x55d398326f99059ff775485246999027b3197955'

const payload = {
    data: [{
        id: 'bsc_' + POOL_ADDRESS,
        type: 'pool',
        attributes: {
            address: POOL_ADDRESS,
            name: 'WBNB / USDT 0.01%',
            volume_usd: {
                h24: '1234567.89',
            },
            reserve_in_usd: '2500000',
        },
        relationships: {
            base_token: {
                data: {
                    id: 'bsc_' + BASE,
                    type: 'token',
                },
            },
            quote_token: {
                data: {
                    id: 'bsc_' + QUOTE,
                    type: 'token',
                },
            },
            dex: {
                data: {
                    id: 'bsc_pancakeswap-v3',
                    type: 'dex',
                },
            },
        },
    }],
    included: [
        {
            id: 'bsc_' + BASE,
            type: 'token',
            attributes: {
                address: BASE,
                name: 'Wrapped BNB',
                symbol: 'WBNB',
                decimals: 18,
                image_url: null,
            },
        },
        {
            id: 'bsc_' + QUOTE,
            type: 'token',
            attributes: {
                address: QUOTE,
                name: 'Tether USD',
                symbol: 'USDT',
                decimals: 18,
                image_url: null,
            },
        },
        {
            id: 'bsc_pancakeswap-v3',
            type: 'dex',
            attributes: {
                name: 'PancakeSwap V3',
            },
        },
    ],
}

describe('market pools', () => {
    it('normalizes EVM pool identity, pair metadata, and 24h volume', () => {
        expect(extractMarketPools(payload)).toEqual([{
            id: 'bsc_' + POOL_ADDRESS,
            chainId: 56,
            networkId: 'bsc',
            address: POOL_ADDRESS,
            name: 'WBNB/USDT',
            protocol: 'v3',
            feePercent: '0.01',
            volume24hUsd: 1234567.89,
            liquidityUsd: 2500000,
            baseToken: {
                chainId: 56,
                address: BASE,
                name: 'Wrapped BNB',
                symbol: 'WBNB',
                decimals: 18,
                logoURI: null,
            },
            quoteToken: {
                chainId: 56,
                address: QUOTE,
                name: 'Tether USD',
                symbol: 'USDT',
                decimals: 18,
                logoURI: null,
            },
        }])
    })

    it('uses the global trending endpoint once and serves the one-minute cache', async () => {
        const request = vi.fn(async () => payload)
        let now = 1000
        const service = createMarketPoolService({
            request,
            now: () => now,
        })

        const first = await service.getPools({
            chainId: 'all',
            limit: 3,
        })
        now += 10_000
        const second = await service.getPools({
            chainId: 'all',
            limit: 3,
        })

        expect(first.pools).toHaveLength(1)
        expect(second).toEqual(first)
        expect(request).toHaveBeenCalledOnce()
        expect(request.mock.calls[0][0]).toContain('/networks/trending_pools')
    })

    it('exposes the normalized list through the public API route', async () => {
        const getPools = vi.fn(async () => ({
            pools: extractMarketPools(payload),
            partial: false,
            generatedAt: 123,
        }))
        const app = Fastify({ logger: false })
        await app.register(createMarketPoolRoutes({ getPools }))

        const response = await app.inject(
            '/v1/market-pools?chainId=56&q=usdt&limit=3',
        )

        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({
            schemaVersion: 1,
            chainId: 56,
            query: 'usdt',
            count: 1,
            partial: false,
        })
        expect(getPools).toHaveBeenCalledWith({
            chainId: 56,
            query: 'usdt',
            limit: 3,
            signal: undefined,
        })
        await app.close()
    })

    it('rejects unsupported pool chains without calling the provider', async () => {
        const getPools = vi.fn()
        const app = Fastify({ logger: false })
        await app.register(createMarketPoolRoutes({ getPools }))

        const response = await app.inject('/v1/market-pools?chainId=999999')

        expect(response.statusCode).toBe(400)
        expect(getPools).not.toHaveBeenCalled()
        await app.close()
    })
})
