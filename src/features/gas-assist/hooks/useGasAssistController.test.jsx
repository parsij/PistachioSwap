// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    gasAssist: null,
    prepaid: null,
}))

vi.mock('./useZeroXGaslessSwap.js', () => ({
    useZeroXGaslessSwap: () => mocks.gasAssist,
}))
vi.mock('./usePrepaidSponsorship.js', () => ({
    usePrepaidSponsorship: () => mocks.prepaid,
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
    activeAmountIn: '51',
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

describe('Gas Assist route ownership', () => {
    beforeEach(() => {
        mocks.gasAssist = {
            quote: null,
            quoteStatus: 'error',
            quoteError: { code: 'ONCHAIN_APPROVAL_REQUIRED', message: 'Approval required.' },
        }
        mocks.prepaid = {
            config: { enabled: true },
            configStatus: 'success',
            configError: null,
        }
    })

    it('never falls back to the normal quote when prepaid approval is required', () => {
        const { result } = renderHook(() => useGasAssistController(baseProps))
        expect(result.current.executionMode).toBe('zero-x-gasless')
        expect(result.current.prepaidRequired).toBe(true)
        expect(result.current.activeQuote).toEqual({ prepaidSponsorshipRequired: true })
        expect(result.current.activeQuoteStatus).toBe('success')
    })

    it('fails closed instead of exposing a normal SwapProxy quote on Gas Assist errors', () => {
        mocks.gasAssist = {
            quote: null,
            quoteStatus: 'error',
            quoteError: { code: 'NO_SPONSORED_ROUTE', message: 'No sponsored route.' },
        }
        mocks.prepaid = { config: null, configStatus: 'error', configError: null }
        const { result } = renderHook(() => useGasAssistController(baseProps))
        expect(result.current.executionMode).toBe('zero-x-gasless')
        expect(result.current.activeQuote).toBeNull()
        expect(result.current.activeQuoteStatus).toBe('error')
    })
})
