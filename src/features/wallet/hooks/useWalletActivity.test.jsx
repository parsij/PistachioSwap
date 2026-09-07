// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    fetchWalletHistory: vi.fn(),
    subscribe: vi.fn(() => () => {}),
}))

vi.mock('../services/walletActivity.js', () => ({
    normalizeWalletActivity: (item) => item,
    readWalletActivity: () => [],
    subscribeWalletActivity: mocks.subscribe,
}))

vi.mock('../services/walletHistory.js', () => ({
    fetchWalletHistory: mocks.fetchWalletHistory,
}))

import {
    REMOTE_WALLET_HISTORY_CHAIN_IDS,
    useWalletActivity,
} from './useWalletActivity.js'

const walletAddress = '0x0000000000000000000000000000000000000001'

describe('useWalletActivity remote history', () => {
    afterEach(() => {
        vi.clearAllMocks()
    })

    it('queries every supported remote-history network in bounded batches', async () => {
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
            chainIds: [56],
            limit: 50,
        }))

        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(mocks.fetchWalletHistory).toHaveBeenCalledTimes(2)
        const queriedChainIds = mocks.fetchWalletHistory.mock.calls
            .flatMap(([input]) => input.chainIds)
        expect(queriedChainIds).toEqual(REMOTE_WALLET_HISTORY_CHAIN_IDS)
        expect(result.current.items).toHaveLength(2)
    })

    it('keeps history from successful batches when another batch fails', async () => {
        mocks.fetchWalletHistory
            .mockResolvedValueOnce({
                items: [{
                    id: 'good-activity',
                    walletAddress,
                    type: 'sent',
                    chainId: 56,
                    timestamp: '2026-09-06T12:00:00.000Z',
                }],
            })
            .mockRejectedValueOnce(new Error('temporary provider failure'))

        const { result } = renderHook(() => useWalletActivity({
            walletAddress,
            limit: 50,
        }))

        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.items.map((item) => item.id))
            .toContain('good-activity')
        expect(result.current.error).toBe('Some wallet history could not be loaded.')
    })

    it('refetches after confirmations, chain changes and reopening the wallet', async () => {
        mocks.fetchWalletHistory.mockResolvedValue({ items: [] })
        const { result, rerender } = renderHook(props => useWalletActivity(props), {
            initialProps: { walletAddress, chainId: 56, enabled: true },
        })
        await waitFor(() => expect(result.current.loading).toBe(false))
        await act(async () => mocks.subscribe.mock.calls.at(-1)[0]())
        await waitFor(() => expect(mocks.fetchWalletHistory).toHaveBeenCalledTimes(4))
        rerender({ walletAddress, chainId: 1, enabled: true })
        await waitFor(() => expect(mocks.fetchWalletHistory).toHaveBeenCalledTimes(6))
        rerender({ walletAddress, chainId: 1, enabled: false })
        rerender({ walletAddress, chainId: 1, enabled: true })
        await waitFor(() => expect(mocks.fetchWalletHistory).toHaveBeenCalledTimes(8))
    })

    it('reports a partial API response rather than treating it as complete history', async () => {
        mocks.fetchWalletHistory.mockResolvedValue({ items: [], partial: true })
        const { result } = renderHook(() => useWalletActivity({ walletAddress }))
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.error).toBe('Some wallet history could not be loaded.')
    })

    it('clears the previous wallet while the new history request is pending', async () => {
        mocks.fetchWalletHistory.mockResolvedValue({ items: [{ walletAddress, chainId: 56, id: 'old', type: 'sent', timestamp: '2026-09-01' }] })
        const { result, rerender } = renderHook(props => useWalletActivity(props), { initialProps: { walletAddress } })
        await waitFor(() => expect(result.current.items).toHaveLength(1))
        mocks.fetchWalletHistory.mockImplementation(() => new Promise(() => {}))
        rerender({ walletAddress: '0x0000000000000000000000000000000000000002' })
        expect(result.current.items).toEqual([])
    })
})
