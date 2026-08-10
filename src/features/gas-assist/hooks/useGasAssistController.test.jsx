// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    gasAssist: null,
    prepaid: null,
    preview: null,
    gasAssistArgs: null,
    prepaidArgs: null,
    previewArgs: null,
}))

vi.mock('./useZeroXGaslessSwap.js', () => ({
    useZeroXGaslessSwap: (args) => {
        mocks.gasAssistArgs = args
        return mocks.gasAssist
    },
}))
vi.mock('./usePrepaidSponsorship.js', () => ({
    usePrepaidSponsorship: (args) => {
        mocks.prepaidArgs = args
        return mocks.prepaid
    },
}))
vi.mock('./useSponsorshipPreview.js', () => ({
    useSponsorshipPreview: (args) => {
        mocks.previewArgs = args
        return mocks.preview
    },
}))

import { useGasAssistController } from './useGasAssistController.js'

const baseProps = {
    routingMode: 'SAME_CHAIN_GASLESS_OR_ASSISTED',
    gasAssistRoutingMode: 'SAME_CHAIN_GASLESS_OR_ASSISTED',
    normalMode: 'normal',
    gaslessMode: 'zero-x-gasless',
    quoteEndpoint: 'http://localhost:3001/v1/quote',
    account: '0x0000000000000000000000000000000000000001',
    sellToken: { address: '0x0000000000000000000000000000000000000002', decimals: 6 },
    buyToken: { address: '0x0000000000000000000000000000000000000003', decimals: 18 },
    sellChainId: 56,
    buyChainId: 56,
    activeAmountIn: '51000000',
    activeAmountSide: 'sell',
    configuredSlippageBps: 50,
    gasAssistConfig: { config: { enabled: true, mode: 'zero-x-gasless' } },
    refreshIndex: 0,
    normalQuote: { selectedQuote: { transaction: { to: '0x0000000000000000000000000000000000000004' } } },
    normalQuoteStatus: 'success',
    buyInputDenomination: 'TOKEN',
    setBuyAmount: vi.fn(),
    setVisibleStatus: vi.fn(),
    onConfirmed: vi.fn(),
}

const preview = {
    netSwapAmountRaw: '50000000',
    paymentAmountRaw: '1000000',
    expectedOutputRaw: '2000000000000000000',
    minimumOutputRaw: '1900000000000000000',
    expiresAt: '2999-01-01T00:00:00.000Z',
    amountsUsd: {
        commercialFee: '0.7',
        gasReserve: '0.3',
        totalPrepayment: '1',
    },
}

describe('exact prepaid Gas Assist route ownership', () => {
    beforeEach(() => {
        mocks.gasAssist = { quote: null, quoteStatus: 'idle', quoteError: null }
        mocks.prepaid = {
            config: { enabled: true },
            configStatus: 'success',
            configError: null,
        }
        mocks.preview = {
            preview,
            status: 'success',
            error: null,
        }
        mocks.gasAssistArgs = null
        mocks.prepaidArgs = null
        mocks.previewArgs = null
        baseProps.setBuyAmount.mockReset()
        baseProps.setVisibleStatus.mockReset()
    })

    it('uses the exact prepaid preview and never calls the provider-integrator quote path', async () => {
        const { result } = renderHook(() => useGasAssistController(baseProps))
        expect(mocks.prepaidArgs.required).toBe(true)
        expect(mocks.previewArgs).toMatchObject({
            required: true,
            enabled: true,
            grossInputAmount: '51000000',
        })
        expect(mocks.gasAssistArgs.quoteEnabled).toBe(false)
        expect(result.current.executionMode).toBe('zero-x-gasless')
        expect(result.current.prepaidRequired).toBe(true)
        expect(result.current.activeQuote).toMatchObject({
            prepaidSponsorshipRequired: true,
            selectedQuote: {
                sellAmount: '50000000',
                buyAmount: '2000000000000000000',
                minimumBuyAmount: '1900000000000000000',
                estimatedGasUsd: '0.3',
                platformFee: {
                    amount: '700000',
                    bps: 0,
                },
            },
        })
        expect(result.current.activeQuoteStatus).toBe('success')
        await waitFor(() => {
            expect(baseProps.setBuyAmount).toHaveBeenCalledWith('2')
        })
    })

    it('fails closed when prepaid sponsorship is disabled instead of exposing a normal SwapProxy quote', () => {
        mocks.prepaid = { config: { enabled: false }, configStatus: 'success', configError: null }
        const { result } = renderHook(() => useGasAssistController(baseProps))
        expect(mocks.gasAssistArgs.quoteEnabled).toBe(false)
        expect(result.current.executionMode).toBe('zero-x-gasless')
        expect(result.current.activeQuote).toBeNull()
        expect(result.current.activeQuoteStatus).toBe('error')
        expect(baseProps.setVisibleStatus).toHaveBeenCalledWith(expect.stringContaining('SPONSORSHIP_UNAVAILABLE'))
    })
})
