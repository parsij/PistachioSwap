// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    fetchWalletHistory: vi.fn(),
}))

vi.mock('../services/walletActivity.js', () => ({
    normalizeWalletActivity: (item) => item,
    readWalletActivity: () => [],
    subscribeWalletActivity: () => () => {},
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
})
