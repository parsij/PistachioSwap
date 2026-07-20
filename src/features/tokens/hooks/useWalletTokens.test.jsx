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
import {
    ALL_CHAIN_WALLET_REFRESH_DELAY_MS,
    useWalletTokens,
} from './useWalletTokens.js'

vi.mock('../services/walletTokens.js', () => ({
    fetchWalletTokens: vi.fn(),
    WALLET_TOKEN_CACHE_NAMESPACE: 'pistachioswap:wallet-tokens:v4:',
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

    it('does not automatically refresh a complete portfolio every 30 seconds', async () => {
        vi.useFakeTimers()
        try {
            fetchWalletTokens.mockResolvedValue({
                tokens: [{ address: ADDRESS_A, chainId: 56 }],
                chainErrors: {},
                queriedChainIds: [56],
                successfulChainIds: [56],
                failedChainIds: [],
                providerRejectedChainIds: [],
                unsupportedChainIds: [],
                partial: false,
                stale: false,
            })
            renderHook(() => useWalletTokens({
                chainId: 'all',
                walletAddress: ADDRESS_A,
                enabled: true,
            }))
            await act(async () => Promise.resolve())
            expect(fetchWalletTokens).toHaveBeenCalledTimes(1)

            await act(async () => {
                await vi.advanceTimersByTimeAsync(30_000)
            })
            expect(fetchWalletTokens).toHaveBeenCalledTimes(1)

            await act(async () => {
                await vi.advanceTimersByTimeAsync(
                    ALL_CHAIN_WALLET_REFRESH_DELAY_MS - 30_000,
                )
            })
            expect(fetchWalletTokens).toHaveBeenCalledTimes(2)
        } finally {
            vi.useRealTimers()
        }
    })

    it('keeps cached balances visible after a refresh failure', async () => {
        fetchWalletTokens
            .mockResolvedValueOnce({
                tokens: [{ address: ADDRESS_A, chainId: 56 }],
                chainErrors: {},
                queriedChainIds: [56],
                successfulChainIds: [56],
                failedChainIds: [],
                providerRejectedChainIds: [],
                unsupportedChainIds: [],
                partial: true,
                stale: true,
            })
            .mockRejectedValueOnce(new Error('HTTP 429 secret'))
        const { result } = renderHook(() => useWalletTokens({
            chainId: 'all',
            walletAddress: ADDRESS_A,
            enabled: true,
        }))
        await waitFor(() => expect(result.current.tokens).toHaveLength(1))
        act(() => result.current.refetch())
        await waitFor(() => expect(result.current.error).toBe(
            'Wallet balances could not be loaded.',
        ))
        expect(result.current.tokens).toEqual([
            { address: ADDRESS_A, chainId: 56 },
        ])
        expect(result.current.queriedChainIds).toEqual([56])
        expect(result.current.successfulChainIds).toEqual([56])
        expect(result.current.partial).toBe(true)
        expect(result.current.stale).toBe(true)
        expect(result.current.error).not.toContain('429')
    })

    it('queues one refresh instead of overlapping an in-flight request', async () => {
        const requests = []
        fetchWalletTokens.mockImplementation(() =>
            new Promise((resolve) => requests.push(resolve)),
        )
        const { result } = renderHook(() => useWalletTokens({
            chainId: 'all',
            walletAddress: ADDRESS_A,
            enabled: true,
        }))
        await waitFor(() => expect(requests).toHaveLength(1))

        act(() => {
            result.current.refetch()
            result.current.refetch()
        })
        expect(fetchWalletTokens).toHaveBeenCalledTimes(1)

        await act(async () => requests[0]({
            tokens: [],
            chainErrors: {},
            queriedChainIds: [56],
            successfulChainIds: [56],
            failedChainIds: [],
            providerRejectedChainIds: [],
            unsupportedChainIds: [],
            partial: false,
            stale: false,
        }))
        await waitFor(() => expect(fetchWalletTokens).toHaveBeenCalledTimes(2))
    })

    it('pauses automatic portfolio refresh while the document is hidden', async () => {
        vi.useFakeTimers()
        const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
        try {
            fetchWalletTokens.mockResolvedValue({
                tokens: [],
                chainErrors: {},
                queriedChainIds: [56],
                successfulChainIds: [56],
                failedChainIds: [],
                providerRejectedChainIds: [],
                unsupportedChainIds: [],
                partial: false,
                stale: false,
            })
            renderHook(() => useWalletTokens({
                chainId: 'all',
                walletAddress: ADDRESS_A,
                enabled: true,
            }))
            await act(async () => Promise.resolve())
            await act(async () => {
                await vi.advanceTimersByTimeAsync(
                    ALL_CHAIN_WALLET_REFRESH_DELAY_MS * 2,
                )
            })
            expect(fetchWalletTokens).toHaveBeenCalledTimes(1)
        } finally {
            hidden.mockRestore()
            vi.useRealTimers()
        }
    })
})
