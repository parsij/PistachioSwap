// @vitest-environment jsdom

import React from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    fetchRoutes: vi.fn(),
    authenticate: vi.fn(),
    prepare: vi.fn(),
    status: vi.fn(),
    submitted: vi.fn(),
}))

vi.mock('../services/crossChainRoutes.js', async (importOriginal) => ({
    ...await importOriginal(),
    fetchCrossChainRoutes: mocks.fetchRoutes,
    authenticateCrossChainWallet: mocks.authenticate,
    prepareCrossChainRoute: mocks.prepare,
    fetchCrossChainRouteStatus: mocks.status,
    markCrossChainRouteSubmitted: mocks.submitted,
}))

import { getOptimisticWalletTransactions, getWalletOperationDisplayState } from '../../wallet/services/optimisticBalances.js'
import { reconcilePendingWalletOperations } from '../../wallet/services/reconcilePendingWalletOperations.js'
import { PUBLIC_ROUTE_STORAGE_KEY } from '../services/crossChainRoutes.js'
import { useCrossChainRoutes } from './useCrossChainRoutes.js'

const account = '0x0000000000000000000000000000000000000001'

function request(amount = '100') {
    return {
        sourceAsset: { chainId: 56, address: '0x0000000000000000000000000000000000000002' },
        destinationAsset: { chainId: 42220, address: '0x0000000000000000000000000000000000000003' },
        amount,
        ownerAddress: account,
        recipient: account,
        slippageBps: 50,
    }
}

function route(id, outputAmount, durationSeconds = 10, feeAmountUsd = '1') {
    const quoteRequest = request()
    return {
        id,
        publicRouteId: id,
        provider: id,
        state: 'quote-ready',
        executionModel: 'evm-transaction',
        sourceChainId: 56,
        destinationChainId: 42220,
        sourceAsset: quoteRequest.sourceAsset,
        destinationAsset: { ...quoteRequest.destinationAsset, symbol: 'CELO', decimals: 18 },
        recipient: account,
        inputAmount: '100',
        outputAmount,
        minimumOutputAmount: outputAmount,
        feeAmountUsd,
        durationSeconds,
        expiresAt: '2030-01-01T00:00:00.000Z',
        warnings: [],
        steps: [],
    }
}

describe('useCrossChainRoutes automatic quoting', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        mocks.fetchRoutes.mockReset()
        mocks.authenticate.mockReset()
        mocks.prepare.mockReset()
        mocks.status.mockReset().mockResolvedValue({ status: 'pending' })
        mocks.submitted.mockReset().mockResolvedValue({})
        localStorage.clear()
        mocks.authenticate.mockResolvedValue({
            walletAddress: account,
            chainId: 56,
            sessionToken: 'session-token',
        })
    })

    afterEach(() => {
    vi.unstubAllGlobals()
        vi.useRealTimers()
    })

    it('debounces identical requests and automatically selects the best net output', async () => {
        mocks.fetchRoutes.mockResolvedValue({
            routes: [route('slow', '120', 20), route('best', '130', 30)],
            selectedRoute: null,
        })
        const quoteRequest = request()
        const { result } = renderHook(() => useCrossChainRoutes({
            endpoint: '/cross-chain',
            account,
            contextKey: 'request-100-v1',
            request: quoteRequest,
            enabled: true,
            debounceMs: 350,
        }))

        await act(() => vi.advanceTimersByTimeAsync(349))
        expect(mocks.fetchRoutes).not.toHaveBeenCalled()
        await act(() => vi.advanceTimersByTimeAsync(1))
        await act(async () => Promise.resolve())
        expect(result.current.phase).toBe('review')
        expect(mocks.fetchRoutes).toHaveBeenCalledTimes(1)
        expect(result.current.selectedRoute.publicRouteId).toBe('best')
    })

    it('aborts an obsolete request and prevents its stale response from replacing the current route', async () => {
        const pending = []
        mocks.fetchRoutes.mockImplementation(({ signal }) => new Promise((resolve) => {
            pending.push({ resolve, signal })
        }))
        const { result, rerender } = renderHook(({ amount }) => useCrossChainRoutes({
            endpoint: '/cross-chain',
            account,
            contextKey: `request-${amount}-v1`,
            request: request(amount),
            enabled: true,
            debounceMs: 350,
        }), { initialProps: { amount: '100' } })

        await act(() => vi.advanceTimersByTimeAsync(350))
        expect(pending).toHaveLength(1)
        rerender({ amount: '200' })
        expect(pending[0].signal.aborted).toBe(true)
        await act(() => vi.advanceTimersByTimeAsync(350))
        expect(pending).toHaveLength(2)
        await act(async () => pending[0].resolve({ routes: [route('stale', '999')], selectedRoute: null }))
        expect(result.current.selectedRoute).toBeNull()
        const current = { ...route('current', '140'), inputAmount: '200' }
        await act(async () => pending[1].resolve({ routes: [current], selectedRoute: null }))
        expect(result.current.selectedRoute?.publicRouteId).toBe('current')
    })

    it('retains a valid route when a same-context refresh fails', async () => {
        mocks.fetchRoutes.mockResolvedValueOnce({
            routes: [route('usable', '130')],
            selectedRoute: null,
        }).mockRejectedValueOnce(new Error('temporary provider failure'))
        const quoteRequest = request()
        const { result } = renderHook(() => useCrossChainRoutes({
            endpoint: '/cross-chain',
            account,
            contextKey: 'request-100-v1',
            request: quoteRequest,
            enabled: true,
            debounceMs: 350,
        }))

        await act(() => vi.advanceTimersByTimeAsync(350))
        expect(result.current.selectedRoute?.publicRouteId).toBe('usable')
        await act(() => result.current.quote(quoteRequest))

        expect(result.current.phase).toBe('review')
        expect(result.current.selectedRoute?.publicRouteId).toBe('usable')
        expect(result.current.error).toBe('temporary provider failure')
    })

    it('ignores a prepared response after the user selects another route', async () => {
        let resolvePrepared
        mocks.fetchRoutes.mockResolvedValue({
            routes: [route('first', '130'), route('second', '120')],
            selectedRoute: null,
        })
        mocks.prepare.mockImplementation(() => new Promise((resolve) => {
            resolvePrepared = resolve
        }))
        const { result } = renderHook(() => useCrossChainRoutes({
            endpoint: '/cross-chain',
            account,
            contextKey: 'request-100-v1',
            request: request(),
            enabled: true,
            debounceMs: 350,
            signMessage: vi.fn(),
        }))

        await act(() => vi.advanceTimersByTimeAsync(350))
        let pendingPrepare
        await act(async () => {
            pendingPrepare = result.current.prepare()
            await Promise.resolve()
        })
        await act(() => result.current.selectRoute(route('second', '120')))
        await act(async () => resolvePrepared({ ...route('first', '130'), publicRouteId: 'first' }))
        await act(async () => pendingPrepare)

        expect(result.current.selectedRoute?.publicRouteId).toBe('second')
        expect(result.current.preparedRoute).toBeNull()
        expect(result.current.phase).toBe('review')
    })
    it('settles a submitted swap after reset without the global route pointer', async () => {
        const prepared = route('submitted-route', '130')
        prepared.sourceAsset = { ...prepared.sourceAsset, decimals: 18, symbol: 'SELL' }
        mocks.fetchRoutes.mockResolvedValue({ routes: [prepared], selectedRoute: prepared })
        mocks.prepare.mockResolvedValue(prepared)
        const { result, unmount } = renderHook(() => useCrossChainRoutes({
            endpoint: '/cross-chain', account, contextKey: 'submitted',
            request: request(), enabled: true, debounceMs: 350, signMessage: vi.fn(),
        }))
        await act(() => vi.advanceTimersByTimeAsync(350))
        await act(async () => { await result.current.prepare() })
        const hash = `0x${'cd'.repeat(32)}`
        await act(async () => { await result.current.markSubmitted(hash) })
        expect(getOptimisticWalletTransactions(account)[0]).toMatchObject({
            transactionHash: hash, settlementMode: 'external', referenceId: 'submitted-route',
        })
        await act(() => result.current.reset())
        unmount()
        // The operation must survive losing the form's singleton route state.
        localStorage.removeItem(PUBLIC_ROUTE_STORAGE_KEY)
        mocks.status.mockResolvedValue({ status: 'completed' })
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }))))
        await reconcilePendingWalletOperations(account)
        expect(mocks.status).toHaveBeenLastCalledWith(expect.objectContaining({ routeId: 'submitted-route' }))
        expect(getWalletOperationDisplayState(account)?.status).toBe('confirmed')
    })

})
