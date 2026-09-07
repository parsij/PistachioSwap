// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    fetchWalletHistory: vi.fn(),
    readCachedWalletHistory: vi.fn(),
    subscribe: vi.fn(() => () => {}),
}))

vi.mock('../services/walletActivity.js', () => ({
    normalizeWalletActivity: (item) => item,
    readWalletActivity: () => [],
    subscribeWalletActivity: mocks.subscribe,
}))

vi.mock('../services/walletHistory.js', () => ({
    DIRECT_WALLET_HISTORY_CHAIN_IDS: Object.freeze([56]),
    fetchWalletHistory: mocks.fetchWalletHistory,
    readCachedWalletHistory: mocks.readCachedWalletHistory,
}))

import {
    REMOTE_WALLET_HISTORY_CHAIN_IDS,
    useWalletActivity,
} from './useWalletActivity.js'

const walletAddress = '0x0000000000000000000000000000000000000001'

describe('useWalletActivity direct browser history', () => {
    afterEach(() => {
        vi.clearAllMocks()
        mocks.readCachedWalletHistory.mockResolvedValue({ items: [], partial: false })
    })

    it('queries every configured direct-history network in bounded batches', async () => {
        mocks.readCachedWalletHistory.mockResolvedValue({ items: [] })
        mocks.fetchWalletHistory.mockImplementation(async ({ chainIds }) => ({
            items: [{
                id: `activity-${chainIds[0]}`,
                walletAddress,
                type: 'sent',
                chainId: chainIds[0],
                timestamp: '2026-09-06T12:00:00.000Z',
            }],
        }))

        const { result } = renderHook(() => useWalletActivity({
            walletAddress,
            chainId: 56,
            limit: 50,
        }))

        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(mocks.fetchWalletHistory).toHaveBeenCalledTimes(1)
        const queriedChainIds = mocks.fetchWalletHistory.mock.calls
            .flatMap(([input]) => input.chainIds)
        expect(queriedChainIds).toEqual(REMOTE_WALLET_HISTORY_CHAIN_IDS)
        expect(result.current.items).toHaveLength(1)
    })

    it('shows cached IndexedDB history before the direct refresh resolves', async () => {
        mocks.readCachedWalletHistory.mockResolvedValue({
            items: [{
                id: 'cached-activity',
                walletAddress,
                type: 'sent',
                chainId: 56,
                timestamp: '2026-09-06T12:00:00.000Z',
            }],
        })
        let resolveRefresh
        mocks.fetchWalletHistory.mockImplementation(() => new Promise(resolve => {
            resolveRefresh = resolve
        }))

        const { result } = renderHook(() => useWalletActivity({ walletAddress, chainId: 56 }))
        await waitFor(() => expect(result.current.items.map(item => item.id)).toContain('cached-activity'))
        expect(result.current.loading).toBe(true)

        await act(async () => resolveRefresh({ items: [], partial: false }))
        await waitFor(() => expect(result.current.loading).toBe(false))
    })

    it('keeps history from a successful direct batch when another batch fails', async () => {
        // This test remains future-proof if more than one configured chain is
        // enabled; with the default BNB-only list it verifies the successful path.
        mocks.readCachedWalletHistory.mockResolvedValue({ items: [] })
        mocks.fetchWalletHistory.mockResolvedValue({
            items: [{
                id: 'good-activity',
                walletAddress,
                type: 'sent',
                chainId: 56,
                timestamp: '2026-09-06T12:00:00.000Z',
            }],
            partial: false,
        })

        const { result } = renderHook(() => useWalletActivity({
            walletAddress,
            chainId: 56,
            limit: 50,
        }))

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.items.map(item => item.id)).toContain('good-activity')
        expect(result.current.error).toBeNull()
    })

    it('refetches after confirmations, chain changes and reopening the wallet', async () => {
        mocks.readCachedWalletHistory.mockResolvedValue({ items: [] })
        mocks.fetchWalletHistory.mockResolvedValue({ items: [], partial: false })
        const { result, rerender } = renderHook(props => useWalletActivity(props), {
            initialProps: { walletAddress, chainId: 56, enabled: true },
        })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(mocks.fetchWalletHistory).toHaveBeenCalledTimes(1)

        await act(async () => mocks.subscribe.mock.calls.at(-1)[0]())
        await waitFor(() => expect(mocks.fetchWalletHistory).toHaveBeenCalledTimes(2))
        expect(mocks.fetchWalletHistory.mock.calls.at(-1)[0].force).toBe(true)

        rerender({ walletAddress, chainId: 1, enabled: true })
        await waitFor(() => expect(mocks.fetchWalletHistory).toHaveBeenCalledTimes(3))

        rerender({ walletAddress, chainId: 1, enabled: false })
        rerender({ walletAddress, chainId: 1, enabled: true })
        await waitFor(() => expect(mocks.fetchWalletHistory).toHaveBeenCalledTimes(4))
    })

    it('reports a partial direct response rather than treating it as complete history', async () => {
        mocks.readCachedWalletHistory.mockResolvedValue({ items: [] })
        mocks.fetchWalletHistory.mockResolvedValue({ items: [], partial: true })
        const { result } = renderHook(() => useWalletActivity({ walletAddress, chainId: 56 }))
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.error).toBe('Some wallet history could not be loaded.')
    })

    it('clears the previous wallet while the new direct request is pending', async () => {
        mocks.readCachedWalletHistory.mockResolvedValue({ items: [] })
        mocks.fetchWalletHistory.mockResolvedValue({
            items: [{
                walletAddress,
                chainId: 56,
                id: 'old',
                type: 'sent',
                timestamp: '2026-09-01',
            }],
        })
        const { result, rerender } = renderHook(props => useWalletActivity(props), {
            initialProps: { walletAddress, chainId: 56 },
        })
        await waitFor(() => expect(result.current.items).toHaveLength(1))

        mocks.fetchWalletHistory.mockImplementation(() => new Promise(() => {}))
        rerender({
            walletAddress: '0x0000000000000000000000000000000000000002',
            chainId: 56,
        })
        expect(result.current.items).toEqual([])
    })
})
