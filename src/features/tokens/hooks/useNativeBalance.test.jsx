// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNativeBalance } from './useNativeBalance.js'
import { beginOptimisticWalletTransaction, confirmOptimisticWalletTransaction, finishOptimisticWalletTransaction } from '../../wallet/services/optimisticBalances.js'

const mocks = vi.hoisted(() => ({ query: null }))
vi.mock('#wallet-runtime', () => ({ useBalance: () => mocks.query }))
afterEach(cleanup)

describe('canonical native balances during pending operations', () => {
    it.each([200n, -200n])('never reapplies a pending delta of %s when the RPC balance refreshes', delta => {
        const wallet = '0x6666666666666666666666666666666666666666'
        const hash = `0x${(delta > 0n ? 'ac' : 'dc').repeat(32)}`
        mocks.query = { data: { value: 1000n }, isSuccess: true, refetch: vi.fn() }
        const { result, rerender, unmount } = renderHook(() => useNativeBalance({ address: wallet, chainId: 10 }))
        try {
            act(() => beginOptimisticWalletTransaction({ walletAddress: wallet, transactionHash: hash,
                changes: [{ chainId: 10, tokenAddress: '0x0000000000000000000000000000000000000000', deltaRaw: delta }] }))
            expect(result.current.value).toBe(1000n)
            expect(mocks.query.refetch).toHaveBeenCalled()
            mocks.query.data = { value: 1000n + delta }
            rerender()
            expect(result.current.value).toBe(1000n + delta)
            act(() => confirmOptimisticWalletTransaction(hash))
            expect(result.current.value).toBe(1000n + delta)
            act(() => finishOptimisticWalletTransaction(hash))
            expect(result.current.value).toBe(1000n + delta)
        } finally {
            unmount()
            finishOptimisticWalletTransaction(hash)
        }
    })
})
