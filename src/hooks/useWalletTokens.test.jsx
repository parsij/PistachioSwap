// @vitest-environment jsdom

import {
    act,
    renderHook,
    waitFor,
} from '@testing-library/react'
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { fetchWalletTokens } from '../services/walletTokens.js'
import { useWalletTokens } from './useWalletTokens.js'

vi.mock('../services/walletTokens.js', () => ({
    fetchWalletTokens: vi.fn(),
    WALLET_TOKEN_CACHE_NAMESPACE: 'pistachioswap:wallet-tokens:v3:',
}))

const ADDRESS_A =
    '0x0000000000000000000000000000000000000001'
const ADDRESS_B =
    '0x0000000000000000000000000000000000000002'

describe('useWalletTokens', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('passes the connected address and clears immediately on disconnect', async () => {
        fetchWalletTokens.mockResolvedValue([
            { address: ADDRESS_A, chainId: 56 },
        ])

        const { result, rerender } = renderHook(
            ({ walletAddress, enabled }) =>
                useWalletTokens({
                    chainId: 56,
                    walletAddress,
                    enabled,
                }),
            {
                initialProps: {
                    walletAddress: ADDRESS_A,
                    enabled: true,
                },
            },
        )

        await waitFor(() => {
            expect(result.current.tokens).toHaveLength(1)
        })

        expect(fetchWalletTokens).toHaveBeenCalledWith(
            expect.objectContaining({
                chainId: 56,
                address: ADDRESS_A,
            }),
        )

        rerender({
            walletAddress: null,
            enabled: false,
        })

        expect(result.current.tokens).toEqual([])
    })

    it('aborts the stale account request when the address changes', async () => {
        const requests = []

        fetchWalletTokens.mockImplementation(
            ({ address, signal }) =>
                new Promise((resolve) => {
                    requests.push({
                        address,
                        signal,
                        resolve,
                    })
                }),
        )

        const { result, rerender } = renderHook(
            ({ walletAddress }) =>
                useWalletTokens({
                    chainId: 56,
                    walletAddress,
                    enabled: true,
                }),
            {
                initialProps: {
                    walletAddress: ADDRESS_A,
                },
            },
        )

        await waitFor(() => {
            expect(requests).toHaveLength(1)
        })

        rerender({ walletAddress: ADDRESS_B })

        await waitFor(() => {
            expect(requests).toHaveLength(2)
        })

        expect(requests[0].signal.aborted).toBe(true)
        expect(result.current.tokens).toEqual([])

        await act(async () => {
            requests[1].resolve([
                { address: ADDRESS_B, chainId: 56 },
            ])
        })

        expect(result.current.tokens).toEqual([
            { address: ADDRESS_B, chainId: 56 },
        ])
    })

    it('does not request BSC balances while disabled', () => {
        renderHook(() =>
            useWalletTokens({
                chainId: 56,
                walletAddress: ADDRESS_A,
                enabled: false,
            }),
        )

        expect(fetchWalletTokens).not.toHaveBeenCalled()
    })

    it('exposes partial all-chain errors without discarding successful tokens', async () => {
        fetchWalletTokens.mockResolvedValue({
            tokens: [{ address: ADDRESS_A, chainId: 56 }],
            chainErrors: { 137: 'temporarily unavailable' },
        })
        const { result } = renderHook(() =>
            useWalletTokens({
                chainId: 'all',
                walletAddress: ADDRESS_A,
                enabled: true,
            }),
        )

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.tokens).toHaveLength(1)
        expect(result.current.chainErrors).toEqual({
            137: 'temporarily unavailable',
        })
        expect(fetchWalletTokens).toHaveBeenCalledWith(expect.objectContaining({
            chainId: 'all',
        }))
    })
})
