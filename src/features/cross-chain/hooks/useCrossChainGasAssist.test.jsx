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

function preview() {
    return {
        order: {
            id: 'preview:route-1',
            grossInputAmountRaw: '1000',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        preparedRoute: {
            publicRouteId: 'route-1',
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
