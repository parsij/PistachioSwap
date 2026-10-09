// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNetworkFees } from './useNetworkFees.js'

function client(chainId) {
    return { chain: { id: chainId }, getChainId: vi.fn().mockResolvedValue(chainId),
        getBlock: vi.fn().mockResolvedValue({ number: 100n, baseFeePerGas: 100n }),
        estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 150n, maxPriorityFeePerGas: 2n }),
        getFeeHistory: vi.fn().mockResolvedValue({ reward: [] }),
        getBalance: vi.fn().mockResolvedValue(100000000n),
    }
}
const account = '0x0000000000000000000000000000000000000001'
afterEach(cleanup)
describe('source network fee lifecycle', () => {
    it('bypasses fee overrides entirely in automatic mode', async () => {
        const rpc = client(10)
        const { result } = renderHook(() => useNetworkFees({ publicClient: rpc, chainId: 10, account, enabled: false }))
        const transaction = { chainId: 10, value: 0n, gas: 100n }
        expect(await result.current.prepareTransaction(transaction)).toBe(transaction)
        expect(rpc.getChainId).not.toHaveBeenCalled()
    })
    it('clears custom choice on source chain changes and ignores late RPC results', async () => {
        const op = client(10)
        const base = client(8453)
        let release
        op.getBlock.mockReturnValue(new Promise(resolve => { release = resolve }))
        const { result, rerender } = renderHook(props => useNetworkFees({ ...props, account, automatic: false }), { initialProps: { publicClient: op, chainId: 10 } })
        await waitFor(() => expect(op.getBlock).toHaveBeenCalled())
        act(() => result.current.select('custom', { maxFeePerGas: 500n, maxPriorityFeePerGas: 2n }))
        rerender({ publicClient: base, chainId: 8453 })
        await waitFor(() => expect(result.current.snapshot?.chainId).toBe(8453))
        expect(result.current.selection).toEqual({ chainId: 8453, mode: 'standard' })
        await act(async () => release({ number: 100n, baseFeePerGas: 100n }))
        expect(result.current.snapshot.chainId).toBe(8453)
        await expect(result.current.prepareTransaction({ gas: 100n, value: 0n }, 10)).rejects.toThrow('do not match')
    })
    it('refreshes the base fee before sending and rejects newly underpriced custom fees', async () => {
        const rpc = client(10)
        const { result } = renderHook(() => useNetworkFees({ publicClient: rpc, chainId: 10, account, automatic: false }))
        await waitFor(() => expect(result.current.snapshot).toBeTruthy())
        act(() => result.current.select('custom', { maxFeePerGas: 150n, maxPriorityFeePerGas: 2n }))
        rpc.getBlock.mockResolvedValue({ number: 101n, baseFeePerGas: 200n })
        await expect(result.current.prepareTransaction({ gas: 100n, value: 0n })).rejects.toThrow('current base fee')
        expect(rpc.getChainId).toHaveBeenCalledTimes(2)
    })
    it('blocks changes during the final balance check', async () => {
        const rpc = client(10)
        let release
        rpc.getBalance.mockReturnValue(new Promise(resolve => { release = resolve }))
        const { result } = renderHook(() => useNetworkFees({ publicClient: rpc, chainId: 10, account, automatic: false }))
        await waitFor(() => expect(result.current.snapshot).toBeTruthy())
        let pending
        act(() => { pending = result.current.prepareTransaction({ gas: 100n, value: 0n }) })
        await waitFor(() => expect(rpc.getBalance).toHaveBeenCalled())
        act(() => result.current.select('high'))
        await act(async () => { release(100000000n); await expect(pending).rejects.toThrow('selection changed') })
    })
})
