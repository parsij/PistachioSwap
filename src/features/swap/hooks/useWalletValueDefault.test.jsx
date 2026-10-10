// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useWalletValueDefault } from './useWalletValueDefault.js'
afterEach(cleanup)
const address = '0x1111111111111111111111111111111111111111'
const tokens = [{ chainId: 8453, address: '0x0000000000000000000000000000000000000000', balance: '1', valueUSD: '100',
    isNative: true, visibility: 'primary', recognitionStatus: 'established', priceConfidence: 'trusted' }]
it('waits for current holdings, defaults once, and never follows later price changes', () => {
    const resetForWallet = vi.fn()
    const initialProps = { address, tokens: [], loading: true, stale: false, hasUserIntent: false, resetForWallet }
    const { rerender } = renderHook(useWalletValueDefault, { initialProps })
    expect(resetForWallet).toHaveBeenLastCalledWith(expect.objectContaining({ chainId: 1 }))
    rerender({ ...initialProps, tokens, loading: false, stale: true })
    expect(resetForWallet).toHaveBeenCalledTimes(1)
    rerender({ ...initialProps, tokens, loading: false })
    expect(resetForWallet).toHaveBeenLastCalledWith(expect.objectContaining({ chainId: 8453 }))
    rerender({ ...initialProps, tokens: [{ ...tokens[0], chainId: 56 }], loading: false })
    expect(resetForWallet).toHaveBeenCalledTimes(2)
})
it('preserves user edits made before balances arrive', () => {
    const resetForWallet = vi.fn()
    const initialProps = { address, tokens: [], loading: true, hasUserIntent: false, resetForWallet }
    const { rerender } = renderHook(useWalletValueDefault, { initialProps })
    rerender({ ...initialProps, hasUserIntent: true })
    rerender({ ...initialProps, tokens, loading: false, hasUserIntent: true })
    expect(resetForWallet).toHaveBeenCalledTimes(1)
})
it('applies a separate default when switching wallets', () => {
    const resetForWallet = vi.fn()
    const initialProps = { address, tokens, loading: false, hasUserIntent: false, resetForWallet }
    const { rerender } = renderHook(useWalletValueDefault, { initialProps })
    rerender({ ...initialProps, address: '0x2222222222222222222222222222222222222222', tokens: [], loading: true })
    expect(resetForWallet).toHaveBeenLastCalledWith(expect.objectContaining({ chainId: 1 }))
    rerender({ ...initialProps, address: '0x2222222222222222222222222222222222222222', tokens: [{ ...tokens[0], chainId: 56 }] })
    expect(resetForWallet).toHaveBeenLastCalledWith(expect.objectContaining({ chainId: 56 }))
})

it('waits for delayed prices while keeping the Ethereum fallback', () => {
    const resetForWallet = vi.fn()
    const initialProps = { address, tokens: [{ ...tokens[0], valueUSD: null }], loading: false, hasUserIntent: false, resetForWallet }
    const { rerender } = renderHook(useWalletValueDefault, { initialProps })
    expect(resetForWallet).toHaveBeenCalledTimes(1)
    rerender({ ...initialProps, tokens })
    expect(resetForWallet).toHaveBeenLastCalledWith(expect.objectContaining({ chainId: 8453 }))
})
