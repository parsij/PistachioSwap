// @vitest-environment jsdom

import { StrictMode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetchConfig: vi.fn() }))

vi.mock('../services/gasAssist.js', () => ({
    fetchGasAssistConfig: mocks.fetchConfig,
}))

import { gasAssistConfigInternals, useGasAssistConfig } from './useGasAssistConfig.js'

const options = {
    quoteEndpoint: 'http://localhost:3001/v1/quote',
    enabled: true,
}

describe('useGasAssistConfig', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        gasAssistConfigInternals.clearCache()
        mocks.fetchConfig.mockResolvedValue({ enabled: true, mode: 'zero-x-gasless' })
    })

    it('fetches config independently of quote eligibility and deduplicates Strict Mode', async () => {
        const { result } = renderHook(() => useGasAssistConfig(options), { wrapper: StrictMode })
        await waitFor(() => expect(result.current.status).toBe('success'))
        expect(result.current.config.mode).toBe('zero-x-gasless')
        expect(mocks.fetchConfig).toHaveBeenCalledOnce()
    })

    it('stays idle without wallet context and loads after context becomes available', async () => {
        const { result, rerender } = renderHook(
            ({ enabled }) => useGasAssistConfig({ ...options, enabled }),
            { initialProps: { enabled: false } },
        )
        expect(result.current.status).toBe('idle')
        expect(mocks.fetchConfig).not.toHaveBeenCalled()
        rerender({ enabled: true })
        await waitFor(() => expect(result.current.status).toBe('success'))
        expect(mocks.fetchConfig).toHaveBeenCalledOnce()
    })

    it('reports request errors and supports an explicit retry', async () => {
        mocks.fetchConfig.mockRejectedValueOnce(new Error('offline'))
        const { result } = renderHook(() => useGasAssistConfig(options))
        await waitFor(() => expect(result.current.status).toBe('error'))
        expect(result.current.config).toBeNull()
        await act(async () => result.current.refetch())
        await waitFor(() => expect(result.current.status).toBe('success'))
        expect(mocks.fetchConfig).toHaveBeenCalledTimes(2)
    })
})
