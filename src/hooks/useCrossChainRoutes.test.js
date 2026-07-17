// @vitest-environment jsdom

import {
    act,
    cleanup,
    renderHook,
    waitFor,
} from '@testing-library/react'
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    getCrossChainPollDelay,
    useCrossChainRoutes,
} from './useCrossChainRoutes.js'

describe('cross-chain route polling', () => {
    afterEach(() => {
        cleanup()
        window.localStorage.clear()
        window.history.replaceState(null, '', '/')
        vi.unstubAllGlobals()
    })

    it('uses bounded exponential backoff after unavailable status checks', () => {
        expect(getCrossChainPollDelay(0)).toBe(3_000)
        expect(getCrossChainPollDelay(1)).toBe(6_000)
        expect(getCrossChainPollDelay(4)).toBe(30_000)
        expect(getCrossChainPollDelay(20)).toBe(30_000)
    })

    it('does not persist preview selection and clears prepared persistence on input context change', async () => {
        const route = {
            publicRouteId: 'route-1',
            sourceChainId: 1,
            expiresAt: '2030-01-01T00:00:00.000Z',
        }
        const fetchMock = vi.fn(async (url) => ({
            ok: true,
            json: async () => String(url).endsWith('/auth/challenge')
                ? { challengeId: 'challenge-1', message: 'authenticate route' }
                : String(url).endsWith('/auth/verify')
                  ? {
                        sessionToken: 'memory-session',
                        walletAddress: '0x0000000000000000000000000000000000000001',
                        chainId: 1,
                    }
                  : String(url).endsWith('/prepare') ? {
                      preparedRoute: {
                          ...route,
                          provider: 'relay',
                          steps: [],
                      },
                  }
                : {
                      ...route,
                      status: 'prepared',
                      steps: [],
                  },
        }))
        vi.stubGlobal('fetch', fetchMock)
        const { result, rerender } = renderHook(
            ({ contextKey }) => useCrossChainRoutes({
                endpoint: 'https://api.example/v1/cross-chain',
                account: '0x0000000000000000000000000000000000000001',
                contextKey,
                signMessage: vi.fn().mockResolvedValue(`0x${'12'.repeat(65)}`),
            }),
            { initialProps: { contextKey: 'wallet:chain:token:amount:recipient:50' } },
        )
        act(() => result.current.selectRoute(route))
        expect(window.localStorage.length).toBe(0)
        await act(() => result.current.prepare())
        await waitFor(() => expect(window.location.search).toContain('route=route-1'))

        rerender({ contextKey: 'wallet:chain:token:new-amount:recipient:50' })
        await waitFor(() => expect(result.current.selectedRoute).toBeNull())
        expect(window.localStorage.length).toBe(0)
        expect(window.location.search).toBe('')
    })
})
