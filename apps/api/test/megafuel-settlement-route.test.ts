import type { Address } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATIVE_TOKEN_ADDRESS } from '../src/lib/address.js'
import { sponsorshipOrderInternals } from '../src/gas-assist/prepaid/order-service.js'

const token = '0x21caef8a43163eea865baee23b9c2e327696a3bf' as Address
const treasury = '0x1111111111111111111111111111111111111111'

function quote({
    provider = 'uniswap',
    quoteId = 'route-1',
    buyAmount = '1000',
}: {
    provider?: 'uniswap' | '0x'
    quoteId?: string
    buyAmount?: string
} = {}) {
    return {
        provider,
        quoteId,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        buyAmount,
        minimumBuyAmount: buyAmount,
    }
}

function dependencies(quoteNormal: ReturnType<typeof vi.fn>) {
    return {
        now: () => new Date('2026-07-21T23:00:00.000Z'),
        getDecimals: vi.fn().mockResolvedValue(18),
        quoteNormal,
    }
}

describe('sell-token settlement route probe', () => {
    beforeEach(() => {
        process.env.TREASURY_ADDRESS = treasury
    })

    it('checks about $0.10 and accepts BNB first', async () => {
        const quoteNormal = vi.fn().mockResolvedValue(quote())
        const result = await sponsorshipOrderInternals.probeSettlementRoute({
            dependencies: dependencies(quoteNormal) as never,
            token,
            tokenDecimals: 6,
            tokenPriceUsdMicros: 1_000_000n,
        })

        expect(result.targetSymbol).toBe('BNB')
        expect(result.probeUsdMicros).toBe('100000')
        expect(result.inputAmountRaw).toBe('100000')
        expect(quoteNormal).toHaveBeenCalledTimes(1)
        expect(quoteNormal).toHaveBeenCalledWith(expect.objectContaining({
            buyToken: NATIVE_TOKEN_ADDRESS,
            sellAmount: 100_000n,
        }))
    })

    it('falls back from BNB to USDT before trying USDC', async () => {
        const quoteNormal = vi.fn()
            .mockRejectedValueOnce(Object.assign(new Error('no BNB route'), { code: 'UNISWAP_NO_ROUTE' }))
            .mockResolvedValueOnce(quote({ provider: '0x', quoteId: 'usdt-route' }))
        const deps = dependencies(quoteNormal)

        const result = await sponsorshipOrderInternals.probeSettlementRoute({
            dependencies: deps as never,
            token,
            tokenDecimals: 6,
            tokenPriceUsdMicros: 2_000_000n,
        })

        expect(result.targetSymbol).toBe('USDT')
        expect(result.provider).toBe('0x')
        expect(quoteNormal).toHaveBeenCalledTimes(2)
        expect(quoteNormal.mock.calls.map(([value]) => value.buyToken)).toEqual([
            NATIVE_TOKEN_ADDRESS,
            sponsorshipOrderInternals.SETTLEMENT_ROUTE_TARGETS[1].buyToken,
        ])
    })

    it('rejects sponsorship when BNB, USDT, and USDC all have no route', async () => {
        const quoteNormal = vi.fn().mockRejectedValue(
            Object.assign(new Error('no route'), { code: 'UNISWAP_NO_ROUTE' }),
        )

        await expect(sponsorshipOrderInternals.probeSettlementRoute({
            dependencies: dependencies(quoteNormal) as never,
            token,
            tokenDecimals: 6,
            tokenPriceUsdMicros: 1_000_000n,
        })).rejects.toMatchObject({
            code: 'SELL_TOKEN_SETTLEMENT_ROUTE_UNAVAILABLE',
            statusCode: 409,
        })
        expect(quoteNormal).toHaveBeenCalledTimes(3)
    })
})
