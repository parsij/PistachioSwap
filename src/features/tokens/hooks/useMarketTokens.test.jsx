// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchMarketTokens } from '../services/marketTokens.js'
import { useMarketTokens } from './useMarketTokens.js'

vi.mock('../services/marketTokens.js', () => ({
    fetchMarketTokens: vi.fn(),
    normalizeMarketChainScope: (value) => value === 'all' ? 'all' : Number(value),
}))

describe('useMarketTokens reliability status', () => {
    beforeEach(() => vi.clearAllMocks())
    afterEach(() => vi.useRealTimers())

    it.each([
        [
            { partial: true },
            'Some market data could not be refreshed.',
        ],
        [
            { partial: true, stale: true },
            'Showing previously loaded market data.',
        ],
        [
            { partial: true, catalogUnavailable: true },
            'Popular tokens are temporarily unavailable.',
        ],
    ])('keeps tokens and exposes a non-blocking status notice', async (
        status,
        notice,
    ) => {
        fetchMarketTokens.mockResolvedValue({
            tokens: status.catalogUnavailable ? [] : [{
                chainId: 56,
                address: '0x0000000000000000000000000000000000000001',
            }],
            stale: false,
            hardStale: false,
            catalogUnavailable: false,
            partial: false,
            ...status,
        })
        const { result } = renderHook(() => useMarketTokens({ chainId: 56 }))

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.error).toBeNull()
        expect(result.current.notice).toBe(notice)
        expect(result.current.tokens).toHaveLength(
            status.catalogUnavailable ? 0 : 1,
        )
    })

    it('normalizes an uncached transport failure without hiding the selector', async () => {
        fetchMarketTokens.mockRejectedValue(new Error('private transport detail'))
        const { result } = renderHook(() => useMarketTokens({ chainId: 56 }))

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current).toMatchObject({
            tokens: [],
            error: null,
            partial: true,
            catalogUnavailable: true,
            notice: 'Popular tokens are temporarily unavailable.',
        })
    })

    it('renders ranked tokens from a partial schema-v7 response', async () => {
        fetchMarketTokens.mockResolvedValue({
            schemaVersion: 7,
            tokens: [{
                chainId: '56',
                address: '0x0000000000000000000000000000000000000001',
            }],
            commonTokens: [],
            fallbackTokens: [],
            partial: true,
            catalogUnavailable: true,
        })
        const { result } = renderHook(() => useMarketTokens({ chainId: 56 }))

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.tokens).toHaveLength(1)
        expect(result.current.schemaVersion).toBe(7)
        expect(result.current.notice).toBe('Some market data could not be refreshed.')
    })

    it('rechecks a cold partial catalog and replaces it with ranked tokens', async () => {
        vi.useFakeTimers()
        fetchMarketTokens
            .mockResolvedValueOnce({
                schemaVersion: 7,
                tokens: [],
                commonTokens: [],
                fallbackTokens: [],
                partial: true,
                catalogUnavailable: true,
            })
            .mockResolvedValueOnce({
                schemaVersion: 7,
                tokens: [{
                    chainId: 56,
                    address: '0x0000000000000000000000000000000000000001',
                }],
                commonTokens: [],
                fallbackTokens: [],
                partial: true,
                catalogUnavailable: false,
            })

        const { result } = renderHook(() => useMarketTokens({ chainId: 56 }))
        await act(() => vi.advanceTimersByTimeAsync(0))
        expect(result.current.tokens).toHaveLength(0)

        await act(() => vi.advanceTimersByTimeAsync(1_500))
        expect(fetchMarketTokens).toHaveBeenCalledTimes(2)
        expect(fetchMarketTokens.mock.calls[1][0].forceRefresh).toBe(true)
        expect(result.current.tokens).toHaveLength(1)
    })

    it('revalidates the all-chain backend at most once per visible minute', async () => {
        vi.useFakeTimers()
        let visibilityState = 'visible'
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => visibilityState,
        })
        fetchMarketTokens.mockResolvedValue({
            schemaVersion: 7,
            tokens: [{
                chainId: 56,
                address: '0x0000000000000000000000000000000000000001',
            }],
            commonTokens: [],
            fallbackTokens: [],
            partial: false,
        })

        renderHook(() => useMarketTokens({ chainId: 'all' }))
        await act(() => vi.advanceTimersByTimeAsync(0))
        expect(fetchMarketTokens).toHaveBeenCalledTimes(1)

        await act(() => vi.advanceTimersByTimeAsync(59_999))
        expect(fetchMarketTokens).toHaveBeenCalledTimes(1)
        await act(() => vi.advanceTimersByTimeAsync(1))
        expect(fetchMarketTokens).toHaveBeenCalledTimes(2)
        expect(fetchMarketTokens.mock.calls[1][0].forceRefresh).toBe(true)

        visibilityState = 'hidden'
        await act(() => vi.advanceTimersByTimeAsync(60_000))
        expect(fetchMarketTokens).toHaveBeenCalledTimes(2)
        visibilityState = 'visible'
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'))
            await Promise.resolve()
        })
        expect(fetchMarketTokens).toHaveBeenCalledTimes(3)
    })

    it('keeps a useful all-chain catalog after revalidation fails', async () => {
        vi.useFakeTimers()
        fetchMarketTokens
            .mockResolvedValueOnce({
                schemaVersion: 7,
                tokens: [{
                    chainId: 56,
                    address: '0x0000000000000000000000000000000000000001',
                }],
                commonTokens: [],
                fallbackTokens: [],
                partial: false,
            })
            .mockRejectedValueOnce(new Error('temporary provider failure'))

        const { result } = renderHook(() => useMarketTokens({ chainId: 'all' }))
        await act(() => vi.advanceTimersByTimeAsync(0))
        expect(result.current.tokens).toHaveLength(1)

        await act(() => vi.advanceTimersByTimeAsync(60_000))
        expect(fetchMarketTokens).toHaveBeenCalledTimes(2)
        expect(result.current.tokens).toHaveLength(1)
        expect(result.current).toMatchObject({
            partial: true,
            stale: true,
            notice: 'Showing previously loaded market data.',
        })
    })
})
