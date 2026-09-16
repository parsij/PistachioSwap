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
    routingMode: 'SAME_CHAIN_GASLESS_OR_ASSISTED',
    gasAssistRoutingMode: 'SAME_CHAIN_GASLESS_OR_ASSISTED',
    normalMode: 'normal',
    gaslessMode: 'prepaid-sponsorship',
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

    it('fetches a fresh preview and replaces the stale review before signing again', async () => {
        const reviewOrder = mocks.prepaid.reviewOrder
        const openPreviewLoading = mocks.prepaid.openPreviewLoading
        const refresh = mocks.preview.refresh
        const { result, rerender } = renderHook(() => useGasAssistController(props))

        act(() => {
            expect(result.current.prepaidSponsorship.refreshQuote()).toBe(true)
        })
        expect(refresh).toHaveBeenCalledOnce()
        expect(openPreviewLoading).toHaveBeenCalledOnce()

        mocks.prepaid = {
            ...mocks.prepaid,
            phase: 'preview-loading',
        }
        mocks.preview = {
            ...mocks.preview,
            preview: null,
            status: 'loading',
        }
        rerender()

        const refreshedPreview = {
            ...preview,
            expectedOutputRaw: '2100000000000000000',
            minimumOutputRaw: '2000000000000000000',
            expiresAt: '2999-01-01T00:05:00.000Z',
        }
        mocks.preview = {
            ...mocks.preview,
            preview: refreshedPreview,
            status: 'success',
        }
        rerender()

        await waitFor(() => {
            expect(reviewOrder).toHaveBeenCalledWith(expect.objectContaining({
                id: `preview:${refreshedPreview.expiresAt}`,
                isPreview: true,
                walletAddress: props.account,
                expectedOutputRaw: refreshedPreview.expectedOutputRaw,
                minimumOutputRaw: refreshedPreview.minimumOutputRaw,
            }))
        })
    })
})
