// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useSwapInputs } from './useSwapInputs.js'

const BNB = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'BNB',
    name: 'BNB',
    decimals: 18,
    isNative: true,
}

const POLYGON_USDC = {
    chainId: 137,
    address: '0x0000000000000000000000000000000000000001',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
}

describe('useSwapInputs selection intent', () => {
    it('distinguishes the configured input token from a token explicitly selected by the user', () => {
        const setSwapChainId = vi.fn()
        const { result } = renderHook(() => useSwapInputs({
            tokensConfig: {
                initialSellToken: BNB,
                initialBuyToken: null,
            },
            tabs: ['Swap'],
            availableTokens: [BNB, POLYGON_USDC],
            swapChainId: 56,
            setSwapChainId,
            fallbackChainLogo: null,
            setVisibleStatus: vi.fn(),
            diagnostic: vi.fn(),
        }))

        expect(result.current.sellToken.uiSelectionOrigin).toBeUndefined()

        act(() => {
            result.current.selectToken({
                token: POLYGON_USDC,
                side: 'sell',
                selectorChainId: 'all',
            })
        })

        expect(result.current.sellToken.uiSelectionOrigin).toBe('user')
        expect(result.current.sellToken.chainId).toBe(137)
        expect(setSwapChainId).toHaveBeenCalledWith(137)
    })
})

it('uses the detail network native input while ordinary buy selection preserves cross-chain intent', () => {
    const setSwapChainId = vi.fn()
    const { result } = renderHook(() => useSwapInputs({
        tokensConfig: { initialSellToken: BNB, initialBuyToken: null }, tabs: ['Swap'], availableTokens: [BNB, POLYGON_USDC],
        swapChainId: 56, setSwapChainId, fallbackChainLogo: null, setVisibleStatus: vi.fn(), diagnostic: vi.fn(),
    }))
    act(() => result.current.selectToken({ token: POLYGON_USDC, side: 'buy', selectorChainId: 137 }))
    expect(result.current.sellToken.symbol).toBe('BNB')
    act(() => result.current.selectToken({ token: POLYGON_USDC, side: 'buy', selectorChainId: 137, pairWithNative: true }))
    expect(result.current.sellToken).toMatchObject({ symbol: 'POL', chainId: 137, isNative: true })
    expect(result.current.buyToken.chainId).toBe(137)
    expect(setSwapChainId).toHaveBeenCalledWith(137)
    expect(result.current.sellAmount).toBe('')
})
