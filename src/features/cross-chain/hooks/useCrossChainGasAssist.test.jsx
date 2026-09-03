// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCrossChainGasAssist } from './useCrossChainGasAssist.js'

const sponsorship = vi.hoisted(() => ({
    configStatus: 'success',
    configError: null,
    error: null,
    open: false,
    openPreviewLoading: vi.fn(),
    reviewOrder: vi.fn(),
    failPreview: vi.fn(),
}))

vi.mock('../../gas-assist/hooks/usePrepaidSponsorship.js', () => ({
    usePrepaidSponsorship: () => sponsorship,
}))

function preview(routeId = 'route-1', overrides = {}) {
    return {
        order: {
            id: `preview:${routeId}`,
            grossInputAmountRaw: '1000',
            netSwapAmountRaw: '900',
            paymentAmountRaw: '100',
            expectedOutputRaw: '850',
            minimumOutputRaw: '840',
            amountsUsd: {
                tradeNotional: '1',
                totalPrepayment: '0.10',
                routeCost: '0.05',
                allInCost: '0.15',
            },
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            ...overrides,
        },
        preparedRoute: {
            publicRouteId: routeId,
            inputAmount: '900',
            outputAmount: '850',
        },
    }
}

function props(overrides = {}) {
    return {
        quoteEndpoint: '/api',
        account: '0x0000000000000000000000000000000000000001',
        sellToken: { chainId: 56, isNative: false },
        buyToken: { chainId: 137, isNative: false },
        totalInputRaw: '1000',
        slippageBps: 50,
        route: { publicRouteId: 'route-1' },
        expected: true,
        preparation: null,
        sponsorshipConfig: { enabled: true, atomicExecution: true },
        previewSponsorship: vi.fn().mockResolvedValue(preview()),
        authenticateSponsorship: vi.fn(),
        prepareSponsorship: vi.fn(),
        completeSponsorship: vi.fn(),
        onConfirmed: vi.fn(),
        ...overrides,
    }
}

beforeEach(() => vi.clearAllMocks())

describe('useCrossChainGasAssist', () => {
    it('prefetches and reuses the exact sponsored quote shown on the swap page', async () => {
        const input = props()
        const { result, rerender } = renderHook((value) => useCrossChainGasAssist(value), {
            initialProps: input,
        })

        await waitFor(() => expect(result.current.status).toBe('success'))
        expect(result.current.preview).toMatchObject({ id: 'preview:route-1' })
        expect(result.current.previewRoute).toMatchObject({ publicRouteId: 'route-1' })
        expect(input.previewSponsorship).toHaveBeenCalledOnce()

        rerender({ ...input })
        await act(async () => {
            await result.current.start()
        })

        expect(input.previewSponsorship).toHaveBeenCalledOnce()
        expect(sponsorship.openPreviewLoading).toHaveBeenCalledOnce()
        expect(sponsorship.reviewOrder).toHaveBeenCalledWith(result.current.preview)
    })

    it('stays idle and does not preview Gas Assist before a positive amount exists', () => {
        const input = props({ totalInputRaw: '0' })
        const { result } = renderHook((value) => useCrossChainGasAssist(value), {
            initialProps: input,
        })

        expect(result.current.status).toBe('idle')
        expect(input.previewSponsorship).not.toHaveBeenCalled()
    })

    it('keeps the direct Gas Assist CTA loading until a cross-chain route exists', async () => {
        const input = props({ route: null, routes: [] })
        const { result, rerender } = renderHook((value) => useCrossChainGasAssist(value), {
            initialProps: input,
        })

        expect(result.current.status).toBe('loading')
        expect(input.previewSponsorship).not.toHaveBeenCalled()

        rerender({
            ...input,
            route: { publicRouteId: 'route-1' },
            routes: [{ publicRouteId: 'route-1' }],
        })
        await waitFor(() => expect(result.current.status).toBe('success'))
        expect(input.previewSponsorship).toHaveBeenCalledOnce()
    })

    it('tries the next quoted provider route when the first sponsored quote is uneconomic', async () => {
        const firstRoute = { publicRouteId: 'route-1' }
        const secondRoute = { publicRouteId: 'route-2' }
        const input = props({
            route: firstRoute,
            routes: [firstRoute, secondRoute],
            previewSponsorship: vi.fn().mockImplementation(async (candidate) => {
                if (candidate.publicRouteId === 'route-1') {
                    return preview('route-1', {
                        amountsUsd: {
                            tradeNotional: '1',
                            totalPrepayment: '0.10',
                            routeCost: '0.95',
                            allInCost: '1.05',
                        },
                    })
                }
                return preview('route-2')
            }),
        })
        const { result } = renderHook((value) => useCrossChainGasAssist(value), {
            initialProps: input,
        })

        await waitFor(() => expect(result.current.status).toBe('success'))
        expect(input.previewSponsorship).toHaveBeenNthCalledWith(1, firstRoute)
        expect(input.previewSponsorship).toHaveBeenNthCalledWith(2, secondRoute)
        expect(result.current.preview).toMatchObject({ id: 'preview:route-2' })
        expect(result.current.previewRoute).toMatchObject({ publicRouteId: 'route-2' })
    })

    it('discards an in-flight preview when Gas Assist becomes unavailable', async () => {
        let resolvePreview
        const input = props({
            previewSponsorship: vi.fn().mockImplementation(() => new Promise((resolve) => {
                resolvePreview = resolve
            })),
        })
        const { result, rerender } = renderHook((value) => useCrossChainGasAssist(value), {
            initialProps: input,
        })

        await waitFor(() => expect(result.current.status).toBe('loading'))
        rerender({
            ...input,
            sponsorshipConfig: { enabled: false, atomicExecution: true },
        })
        await act(async () => {
            resolvePreview(preview())
            await Promise.resolve()
        })

        expect(result.current.available).toBe(false)
        expect(result.current.preview).toBeNull()
        expect(result.current.previewRoute).toBeNull()
    })
})
