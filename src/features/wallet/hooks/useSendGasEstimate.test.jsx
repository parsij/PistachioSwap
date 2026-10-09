// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { decodeFunctionData, erc20Abi } from 'viem'
import { useSendGasEstimate } from './useSendGasEstimate.js'
const account = '0x0000000000000000000000000000000000000001'
const recipient = '0x0000000000000000000000000000000000000002'
const token = { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6, chainId: 8453 }
const client = (id = 8453) => ({ chain: { id }, getChainId: vi.fn(async () => id), estimateGas: vi.fn(async () => 60_000n) })
afterEach(cleanup)
it('estimates exact ERC-20 calldata before review and never requests signing', async () => {
    const publicClient = client()
    const { result } = renderHook(() => useSendGasEstimate({ publicClient, account, recipient, token, amount: '5', chainId: 8453, enabled: true }))
    await waitFor(() => expect(result.current.gas).toBe(72_000n))
    const request = publicClient.estimateGas.mock.calls[0][0]
    expect(request).toMatchObject({ account, to: token.address, value: 0n })
    expect(decodeFunctionData({ abi: erc20Abi, data: request.data }).args).toEqual([recipient, 5_000_000n])
    expect(result.current.preliminary).toBe(false)
})
it('discards a slow previous-chain estimate after switching tokens', async () => {
    let finish
    const old = client(); old.estimateGas.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const next = client(10)
    const { result, rerender } = renderHook(props => useSendGasEstimate({ account, recipient, amount: '5', enabled: true, ...props }),
        { initialProps: { publicClient: old, chainId: 8453, token } })
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    rerender({ publicClient: next, chainId: 10, token: { ...token, chainId: 10 } })
    await act(async () => finish(999_999n))
    expect(result.current.gas).toBeUndefined()
    await waitFor(() => expect(result.current.gas).toBe(72_000n))
})
it('fails visibly when the RPC belongs to a different chain', async () => {
    const rpc = client(56)
    const { result } = renderHook(() => useSendGasEstimate({ publicClient: rpc, account, recipient, token, amount: '5', chainId: 8453, enabled: true }))
    await waitFor(() => expect(result.current.error).toContain('unavailable'))
    expect(rpc.estimateGas).not.toHaveBeenCalled()
})
