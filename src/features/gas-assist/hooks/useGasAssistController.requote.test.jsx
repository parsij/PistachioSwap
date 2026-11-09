// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    prepaid: null,
    preview: null,
}))

vi.mock('./usePrepaidSponsorship.js', () => ({
    usePrepaidSponsorship: () => mocks.prepaid,
}))

vi.mock('./useSponsorshipPreview.js', () => ({
    useSponsorshipPreview: () => mocks.preview,
}))

vi.mock('../../wallet/services/walletActivity.js', () => ({
    recordWalletActivity: vi.fn(),
}))

import { useGasAssistController } from './useGasAssistController.js'

const props = {
    routingMode: 'SAME_CHAIN_GAS_ASSIST',
    gasAssistRoutingMode: 'SAME_CHAIN_GAS_ASSIST',
    normalMode: 'normal',
    gasAssistExecutionMode: 'prepaid-sponsorship',
    quoteEndpoint: 'https://example.test/v1/sponsorship',
    account: '0x0000000000000000000000000000000000000001',
    sellToken: {
        address: '0x0000000000000000000000000000000000000002',
        symbol: 'SELL',
        decimals: 6,
    },
    buyToken: {
        address: '0x0000000000000000000000000000000000000003',
        symbol: 'BUY',
        decimals: 18,
    },
    activeAmountIn: '51000000',
    activeAmountSide: 'sell',
    configuredSlippageBps: 50,
    normalQuote: null,
    normalQuoteStatus: 'idle',
    buyInputDenomination: 'TOKEN',
    setBuyAmount: vi.fn(),
    setVisibleStatus: vi.fn(),
    onConfirmed: vi.fn(),
}

const preview = {
    grossInputAmountRaw: '51000000',
    netSwapAmountRaw: '50000000',
    paymentAmountRaw: '1000000',
    paymentToken: props.sellToken.address,
    paymentTokenDecimals: 6,
    paymentTokenSymbol: 'SELL',
    expectedOutputRaw: '2000000000000000000',
    minimumOutputRaw: '1900000000000000000',
    expiresAt: '2999-01-01T00:00:00.000Z',
    amountsUsd: {
        tradeNotional: '51',
        commercialFee: '0.7',
        gasReserve: '0.3',
        estimatedSponsoredGas: '0.2',
        totalPrepayment: '1',
    },
}

describe('Gas Assist requote orchestration', () => {
    it('refreshes an open one-confirmation review automatically and leaves the option off unchanged', async () => {
        vi.useFakeTimers()
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
        try {
            mocks.prepaid.phase = 'review'
            const { rerender, unmount } = renderHook(({ enabled }) => useGasAssistController({ ...props, oneConfirmationEnabled: enabled }),
                { initialProps: { enabled: false } })
            await act(() => vi.advanceTimersByTimeAsync(30_000))
            expect(mocks.preview.refresh).not.toHaveBeenCalled()
            rerender({ enabled: true })
            await act(() => vi.advanceTimersByTimeAsync(30_000))
            // The real authenticated order is prepared at the review entry,
            // not by opening a temporary preview for another confirmation.
            expect(mocks.preview.refresh).not.toHaveBeenCalled()
            expect(mocks.prepaid.start).not.toHaveBeenCalled()
            unmount()
        } finally { visibility.mockRestore(); vi.useRealTimers() }
    })

    it('refreshes an expired preview instead of invoking wallet signing', async () => {
        mocks.prepaid.phase = 'review'
        mocks.prepaid.order = { isPreview: true, expiresAt: '2020-01-01T00:00:00Z' }
        mocks.prepaid.signPackage = vi.fn()
        const { result } = renderHook(() => useGasAssistController({ ...props, oneConfirmationEnabled: true }))
        await act(() => result.current.prepaidSponsorship.signPackage())
        expect(mocks.prepaid.start).toHaveBeenCalledOnce()
        expect(mocks.prepaid.signPackage).not.toHaveBeenCalled()
    })

    it('does not refresh an operation that is already being signed', async () => {
        vi.useFakeTimers()
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
        try {
            mocks.prepaid.phase = 'package-signing'
            const { unmount } = renderHook(() => useGasAssistController({ ...props, oneConfirmationEnabled: true }))
            await act(() => vi.advanceTimersByTimeAsync(60_000))
            expect(mocks.preview.refresh).not.toHaveBeenCalled()
            unmount()
        } finally { visibility.mockRestore(); vi.useRealTimers() }
    })

    beforeEach(() => {
        props.setBuyAmount.mockReset()
        props.setVisibleStatus.mockReset()
        props.onConfirmed.mockReset()

        mocks.prepaid = {
            open: true,
            phase: 'failed',
            error: { code: 'ORDER_REQUOTE_REQUIRED' },
            config: { enabled: true },
            configStatus: 'success',
            configError: null,
            start: vi.fn(),
            reviewOrder: vi.fn(),
            openPreviewLoading: vi.fn(),
            failPreview: vi.fn(),
        }
        mocks.preview = {
            preview,
            status: 'success',
            error: null,
            refresh: vi.fn(() => true),
        }
    })

    it('opens the authenticated final order instead of a provisional quote on review', async () => {
        const { result } = renderHook(() => useGasAssistController(props))
        expect(result.current.prepaidSponsorship.start).toBe(mocks.prepaid.start)
        await act(async () => {
            await result.current.prepaidSponsorship.start()
        })
        expect(mocks.prepaid.start).toHaveBeenCalledOnce()
        expect(mocks.prepaid.reviewOrder).not.toHaveBeenCalled()
        expect(mocks.prepaid.openPreviewLoading).not.toHaveBeenCalled()
    })

    it('re-authenticates and obtains a final order when the user requests a new quote', () => {
        const { result } = renderHook(() => useGasAssistController(props))
        act(() => {
            expect(result.current.prepaidSponsorship.refreshQuote()).toBe(true)
        })
        expect(mocks.prepaid.start).toHaveBeenCalledOnce()
        expect(mocks.prepaid.reviewOrder).not.toHaveBeenCalled()
        expect(mocks.preview.refresh).not.toHaveBeenCalled()
    })

    it('does not trigger background wallet authentication for a final reviewed quote', async () => {
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
        vi.useFakeTimers()
        try {
            mocks.prepaid.phase = 'review'
            mocks.prepaid.order = { id: 'authenticated', isPreview: false }
            const { unmount } = renderHook(() =>
                useGasAssistController({ ...props, oneConfirmationEnabled: true }))
            await act(() => vi.advanceTimersByTimeAsync(60_000))
            expect(mocks.prepaid.start).not.toHaveBeenCalled()
            expect(mocks.preview.refresh).not.toHaveBeenCalled()
            unmount()
        } finally {
            visibility.mockRestore()
            vi.useRealTimers()
        }
    })
})
