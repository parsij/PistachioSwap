import { describe, expect, it } from 'vitest'

import { buildSponsorshipPreviewOrder } from './sponsorshipPreviewOrder.js'

const walletAddress = '0x880c39159919700166e4612d4b7aa344fc21cd6f'

describe('buildSponsorshipPreviewOrder', () => {
    it('maps preview fields into a reviewable prepaid order', () => {
        const preview = {
            chainId: 56,
            sellToken: '0x000ae314e2a2172a039b26378814c252734f556a',
            buyToken: '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409',
            grossInputAmountRaw: '587039000000000000000',
            netSwapAmountRaw: '429470000000000000000',
            paymentToken: '0x000ae314e2a2172a039b26378814c252734f556a',
            paymentTokenSymbol: 'ASTER',
            paymentAmountRaw: '157568000000000000000',
            paymentTokenDecimals: 18,
            expectedOutputRaw: '257831000000000000',
            minimumOutputRaw: '256542000000000000',
            expiresAt: '2026-08-16T19:37:47.779Z',
            amountsUsd: {
                fixedServiceFee: '0.067',
                platformFee: '0.0105',
                gasReserve: '0.0169',
                totalPrepayment: '0.0945',
            },
        }

        const order = buildSponsorshipPreviewOrder(preview, walletAddress)

        expect(order).toMatchObject({
            isPreview: true,
            status: 'preview',
            walletAddress,
            currentRequiredAction: 'prepare-payment',
            grossInputAmountRaw: preview.grossInputAmountRaw,
            expectedOutputRaw: preview.expectedOutputRaw,
            totalPrepaymentUsdMicros: '94500',
        })
        expect(order.id.startsWith('preview:')).toBe(true)
    })
})
