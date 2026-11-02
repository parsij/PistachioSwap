// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { quoteNeedsRefresh, useAutomaticQuoteRefresh } from './useAutomaticQuoteRefresh.js'

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-02T17:00:00Z'))
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

it('refreshes a visible review automatically without waiting for expiry', async () => {
    const onRefresh = vi.fn()
    renderHook(() => useAutomaticQuoteRefresh({ enabled: true,
        expiresAt: new Date(Date.now() + 300_000).toISOString(), onRefresh }))
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(onRefresh).toHaveBeenCalledOnce()
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(onRefresh).toHaveBeenCalledOnce()
})

it('refreshes before expiry and pauses when disabled for authorization', async () => {
    const onRefresh = vi.fn()
    const expiresAt = new Date(Date.now() + 20_000).toISOString()
    const { rerender } = renderHook(({ enabled }) => useAutomaticQuoteRefresh({ enabled, expiresAt, onRefresh }),
        { initialProps: { enabled: true } })
    await act(() => vi.advanceTimersByTimeAsync(5_000))
    expect(onRefresh).toHaveBeenCalledOnce()
    rerender({ enabled: false })
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(onRefresh).toHaveBeenCalledOnce()
})

it('does not fetch in a hidden tab and refreshes once when it becomes visible', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const onRefresh = vi.fn()
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    renderHook(() => useAutomaticQuoteRefresh({ enabled: true, expiresAt, onRefresh }))
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(onRefresh).not.toHaveBeenCalled()
    visibility.mockReturnValue('visible')
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(onRefresh).toHaveBeenCalledOnce()
})

it('cancels pending refreshes when the setting is switched off or the component unmounts', async () => {
    const onRefresh = vi.fn()
    const expiresAt = new Date(Date.now() + 300_000).toISOString()
    const { rerender, unmount } = renderHook(({ enabled }) => useAutomaticQuoteRefresh({ enabled, expiresAt, onRefresh }),
        { initialProps: { enabled: true } })
    rerender({ enabled: false })
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(onRefresh).not.toHaveBeenCalled()
    rerender({ enabled: true })
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(onRefresh).not.toHaveBeenCalled()
})

it('treats missing, invalid and nearly expired quotes as unfit for signing', () => {
    expect(quoteNeedsRefresh(undefined)).toBe(true)
    expect(quoteNeedsRefresh('invalid')).toBe(true)
    expect(quoteNeedsRefresh(new Date(Date.now() + 10_000).toISOString())).toBe(true)
    expect(quoteNeedsRefresh(new Date(Date.now() + 60_000).toISOString())).toBe(false)
})
