// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetchSwapQuote: vi.fn() }))
vi.mock('../services/quotes.js', async () => {
    const actual = await vi.importActual('../services/quotes.js')
    return { ...actual, fetchSwapQuote: mocks.fetchSwapQuote }
})

import { useSwapQuote } from './useSwapQuote.js'

it('does not request or retain a normal provider quote while Gas Assist owns the route', () => {
    const setBuyAmount = vi.fn()
    const { result } = renderHook(() => useSwapQuote({
        endpoint: 'http://localhost:3001/v1/quote',
        debounceMs: 0,
        chainId: 56,
        walletState: { isConnected: true, isCorrectNetwork: true, chainId: 56 },
        walletAddress: '0x0000000000000000000000000000000000000001',
        sellToken: { address: '0x0000000000000000000000000000000000000002', chainId: 56, decimals: 6 },
        buyToken: { address: '0x0000000000000000000000000000000000000003', chainId: 56, decimals: 18 },
        sellChainId: 56,
        buyChainId: 56,
        activeAmountSide: 'sell',
        activeAmountIn: '51',
        activeBuyAmountIn: null,
        sellInputDenomination: 'TOKEN',
        buyInputDenomination: 'TOKEN',
        sellDisplayPrice: '4000',
        buyDisplayPrice: '600',
        configuredSlippageBps: 50,
        routingMode: 'SAME_CHAIN_GASLESS_OR_ASSISTED',
        crossChainMode: 'CROSS_CHAIN',
        gasAssistMode: 'SAME_CHAIN_GASLESS_OR_ASSISTED',
        setSellAmount: vi.fn(),
        setBuyAmount,
        setVisibleStatus: vi.fn(),
        diagnostic: vi.fn(),
    }))
    expect(result.current.quote).toBeNull()
    expect(result.current.quoteStatus).toBe('idle')
    expect(mocks.fetchSwapQuote).not.toHaveBeenCalled()
})
