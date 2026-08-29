// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useZeroXGaslessSwap } from './useZeroXGaslessSwap.js'

describe('useZeroXGaslessSwap compatibility shim', () => {
    it('stays unavailable and exposes no legacy quote or dialog flow', () => {
        const { result } = renderHook(() => useZeroXGaslessSwap())

        expect(result.current).toMatchObject({
            config: null,
            quote: null,
            quoteStatus: 'idle',
            quoteError: null,
            available: false,
            dialog: {
                open: false,
                state: 'removed',
            },
        })
    })

    it('fails closed when legacy execution is requested', () => {
        const { result } = renderHook(() => useZeroXGaslessSwap())

        expect(() => result.current.open()).toThrow(
            'Legacy 0x Gasless execution has been removed. Use atomic Gas Assist.',
        )
        expect(() => result.current.confirm()).toThrow(
            'Legacy 0x Gasless execution has been removed. Use atomic Gas Assist.',
        )
        expect(result.current.close()).toBeUndefined()
    })
})
