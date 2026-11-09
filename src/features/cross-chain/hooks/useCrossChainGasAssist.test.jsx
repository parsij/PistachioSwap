import { CHECKED_ACCOUNT_RUNTIME_HASH } from '../../gas-assist/services/checkedAccountIdentity.js'
// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCrossChainGasAssist } from './useCrossChainGasAssist.js'

const submission = vi.hoisted(() => ({
    params: null,
    activity: vi.fn(),
    optimistic: vi.fn(),
}))

vi.mock('../../wallet/services/walletActivity.js', () => ({
    recordWalletActivity: submission.activity,
    transitionExistingWalletActivity: vi.fn(),
}))
vi.mock('../../wallet/services/optimisticBalances.js', () => ({
    beginOptimisticWalletTransaction: submission.optimistic,
    confirmOptimisticWalletTransaction: vi.fn(),
    finishOptimisticWalletTransaction: vi.fn(),
    rollbackOptimisticWalletTransaction: vi.fn(),
}))

const sponsorship = vi.hoisted(() => ({
    configStatus: 'success',
    configError: null,
    error: null,
    open: false,
    openPreviewLoading: vi.fn(),
    start: vi.fn(async () => undefined),
    close: vi.fn(),
    reviewOrder: vi.fn(),
    failPreview: vi.fn(),
}))

vi.mock('../../gas-assist/hooks/usePrepaidSponsorship.js', () => ({
    usePrepaidSponsorship: (params) => {
        submission.params = params
        return sponsorship
    },
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
        sponsorshipConfig: { supported: true, chainId: 56, enabled: true, atomicExecution: true },
        previewSponsorship: vi.fn().mockResolvedValue(preview()),
        authenticateSponsorship: vi.fn(),
        prepareSponsorship: vi.fn(),
        completeSponsorship: vi.fn(),
        onConfirmed: vi.fn(),
        ...overrides,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    submission.params = null
    sponsorship.open = false
    sponsorship.phase = 'idle'
    sponsorship.order = null
    vi.stubEnv('VITE_GAS_ASSIST_ENABLED', 'true')
    vi.stubEnv('VITE_SELF_HOSTED_PAYMASTER_ENABLED', 'true')
})
afterEach(() => vi.unstubAllEnvs())

describe('useCrossChainGasAssist', () => {
    it('ignores an old recovered transaction instead of creating a fresh swapping entry', async () => {
        const input = props()
        const { result } = renderHook(value => useCrossChainGasAssist(value), {
            initialProps: input,
        })
        await waitFor(() => expect(result.current.status).toBe('success'))
        await act(async () => submission.params.onSubmitted({
            id: 'old-order', crossChainRouteId: 'route-1',
            recoveredFromStorage: true,
            swapTransactionHash: `0x${'a'.repeat(64)}`,
            grossInputAmountRaw: '1350000',
        }))
        expect(submission.activity).not.toHaveBeenCalled()
        expect(submission.optimistic).not.toHaveBeenCalled()
        expect(input.completeSponsorship).not.toHaveBeenCalled()
    })

    it('rejects a source hash mismatched to the authenticated prepared order', async () => {
        const input = props()
        const { result } = renderHook(value => useCrossChainGasAssist(value), {
            initialProps: input,
        })
        await waitFor(() => expect(result.current.status).toBe('success'))
        await expect(submission.params.onSubmitted({
            id: 'old-order', crossChainRouteId: 'route-1',
            swapTransactionHash: `0x${'a'.repeat(64)}`,
            grossInputAmountRaw: '1350000',
        })).rejects.toThrow(/does not match the authenticated cross-chain route/)
        expect(submission.activity).not.toHaveBeenCalled()
        expect(submission.optimistic).not.toHaveBeenCalled()
        expect(input.completeSponsorship).not.toHaveBeenCalled()
    })

    it('uses the frozen authenticated route for a genuinely new submitted operation', async () => {
        const finalRoute = {
            publicRouteId: 'route-1',
            sourceChainId: 56,
            destinationChainId: 137,
            outputAmount: '850',
        }
        const input = props({
            prepareSponsorship: vi.fn().mockResolvedValue({
                order: {
                    id: 'new-order',
                    crossChainRouteId: 'route-1',
                },
                preparedRoute: finalRoute,
            }),
        })
        const { result } = renderHook(value => useCrossChainGasAssist(value), {
            initialProps: input,
        })
        await waitFor(() => expect(result.current.status).toBe('success'))
        await act(async () => submission.params.createOrder({ idempotencyKey: 'new-key' }))
        const hash = `0x${'b'.repeat(64)}`
        await act(async () => submission.params.onSubmitted({
            id: 'new-order', crossChainRouteId: 'route-1',
            swapTransactionHash: hash,
            grossInputAmountRaw: '1000', expectedOutputRaw: '850',
        }))
        expect(submission.activity).toHaveBeenCalledWith(expect.objectContaining({
            hash, status: 'pending', sellAmount: '1000',
        }))
        expect(submission.optimistic).toHaveBeenCalledWith(expect.objectContaining({
            transactionHash: hash, settlementMode: 'external',
            referenceId: 'route-1',
        }))
        expect(input.completeSponsorship).toHaveBeenCalledWith({
            preparedRoute: finalRoute,
            transactionHash: hash,
        })
    })

    it('refreshes an open one-confirmation review even while the cached route is still valid', async () => {
        const input = props({ oneConfirmationEnabled: true })
        const { result, rerender, unmount } = renderHook(value => useCrossChainGasAssist(value), { initialProps: input })
        await waitFor(() => expect(result.current.status).toBe('success'))
        vi.useFakeTimers()
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
        try {
            sponsorship.open = true
            sponsorship.phase = 'review'
            sponsorship.order = { ...preview().order, isPreview: true }
            rerender(input)
            await act(() => vi.advanceTimersByTimeAsync(30_000))
            expect(input.previewSponsorship).toHaveBeenCalledTimes(2)
            expect(sponsorship.openPreviewLoading).toHaveBeenCalledOnce()
            expect(sponsorship.start).toHaveBeenCalledOnce()
            expect(sponsorship.reviewOrder).not.toHaveBeenCalled()
        } finally { unmount(); visibility.mockRestore(); vi.useRealTimers() }
    })
    it('never reauthenticates or rewrites a final reviewed order in the background', async () => {
        const input = props({ oneConfirmationEnabled: true })
        const { result, rerender, unmount } = renderHook(value => useCrossChainGasAssist(value), {
            initialProps: input,
        })
        await waitFor(() => expect(result.current.status).toBe('success'))
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
        vi.useFakeTimers()
        try {
            sponsorship.open = true
            sponsorship.phase = 'review'
            sponsorship.order = { ...preview().order, id: 'authenticated-order', isPreview: false }
            rerender(input)
            await act(() => vi.advanceTimersByTimeAsync(60_000))
            expect(sponsorship.start).not.toHaveBeenCalled()
            expect(sponsorship.openPreviewLoading).not.toHaveBeenCalled()
        } finally {
            unmount()
            visibility.mockRestore()
            vi.useRealTimers()
        }
    })

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
        expect(sponsorship.start).toHaveBeenCalledOnce()
        expect(sponsorship.reviewOrder).not.toHaveBeenCalled()
    })

    it('does not create a final order if the user closes while the bridge preview refreshes', async () => {
        const input = props()
        const { result } = renderHook(value => useCrossChainGasAssist(value), {
            initialProps: input,
        })
        await waitFor(() => expect(result.current.status).toBe('success'))

        let finishPreview
        input.previewSponsorship.mockImplementationOnce(() => new Promise(resolve => {
            finishPreview = resolve
        }))
        let opening
        act(() => { opening = result.current.start({ force: true }) })
        await waitFor(() => expect(input.previewSponsorship).toHaveBeenCalledTimes(2))

        act(() => result.current.sponsorship.close())
        await act(async () => {
            finishPreview(preview())
            await opening
        })
        expect(sponsorship.close).toHaveBeenCalledOnce()
        expect(sponsorship.start).not.toHaveBeenCalled()
        expect(sponsorship.reviewOrder).not.toHaveBeenCalled()
    })

    it.each([56, 8453])('uses self-hosted direct cross-chain execution on source chain %i', async chainId => {
        const input = props({
            sellToken: { chainId, isNative: false },
            sponsorshipConfig: {
                supported: true,
                chainId,
                enabled: true,
                atomicExecution: false,
                provider: 'pistachio-paymaster-v08',
                execution: 'erc4337-v08-eip7702-direct',
                delegate: '0x8888888888888888888888888888888888888888',
                checkedExecution: { version: 'pistachio-checked-7702-v1', delegateCodeHash: CHECKED_ACCOUNT_RUNTIME_HASH, entryPointCodeHash: `0x${'11'.repeat(32)}`, paymasterCodeHash: `0x${'22'.repeat(32)}` },
            },
        })
        const { result } = renderHook((value) => useCrossChainGasAssist(value), {
            initialProps: input,
        })

        await waitFor(() => expect(result.current.status).toBe('success'))
        expect(result.current.available).toBe(true)
        expect(input.previewSponsorship).toHaveBeenCalledOnce()
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
