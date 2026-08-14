// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    fetchConfig: vi.fn(),
    authenticate: vi.fn(),
    createOrder: vi.fn(),
    fetchOrder: vi.fn(),
    preparePackage: vi.fn(),
    submitPackage: vi.fn(),
    signPackage: vi.fn(),
}))

vi.mock('wagmi', () => ({
    useConnection: () => ({ connector: { id: 'pistachio-local' } }),
    useWalletClient: () => ({ data: { account: { address: '0x1' }, request: vi.fn() } }),
}))

vi.mock('../services/prepaidSponsorship.js', () => ({
    fetchSponsorshipConfig: mocks.fetchConfig,
    authenticateSponsorshipWallet: mocks.authenticate,
    createSponsorshipOrder: mocks.createOrder,
    fetchSponsorshipOrder: mocks.fetchOrder,
    prepareSponsorshipApproval: vi.fn(),
    prepareSponsorshipContinuation: vi.fn(),
    prepareSponsorshipPayment: vi.fn(),
    prepareSponsorshipPackage: mocks.preparePackage,
    submitSponsorshipIntent: vi.fn(),
    submitSponsorshipPackage: mocks.submitPackage,
}))

vi.mock('../services/rawTransactionSigning.js', () => ({
    detectRawTransactionSigning: () => ({
        rawTransactionSigningSupported: true,
        method: 'eth_signTransaction',
        transport: 'pistachio-local',
        account: null,
    }),
    signPreparedSponsoredTransaction: vi.fn(),
    signPreparedSponsoredPackage: mocks.signPackage,
}))

import { usePrepaidSponsorship } from './usePrepaidSponsorship.js'

const walletA = '0x0000000000000000000000000000000000000001'
const walletB = '0x0000000000000000000000000000000000000002'
const tokenA = { address: '0x0000000000000000000000000000000000000011' }
const tokenB = { address: '0x0000000000000000000000000000000000000012' }

function setup(walletAddress = walletA, onConfirmed = vi.fn(), overrides = {}) {
    return renderHook(({ wallet, inputOverrides }) => usePrepaidSponsorship({
        quoteEndpoint: '/v1/quote',
        walletAddress: wallet,
        sellToken: tokenA,
        buyToken: tokenB,
        grossInputAmount: '1000',
        slippageBps: 50,
        required: true,
        onConfirmed,
        ...inputOverrides,
    }), {
        initialProps: {
            wallet: walletAddress,
            inputOverrides: overrides,
        },
    })
}

async function waitForConfig(result) {
    await waitFor(() => expect(result.current.config).toEqual({ enabled: true }))
}

describe('prepaid sponsorship async ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.fetchConfig.mockResolvedValue({ enabled: true })
        mocks.authenticate.mockResolvedValue({ sessionToken: 'session' })
        mocks.createOrder.mockResolvedValue({ id: 'order-1', status: 'awaiting-payment' })
        mocks.preparePackage.mockResolvedValue({
            orderId: 'order-1',
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
            transactions: [],
        })
        mocks.signPackage.mockResolvedValue({ packageStored: true })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('continues order polling after a transient status failure without converting it into a fatal error', async () => {
        const onConfirmed = vi.fn()
        mocks.fetchOrder
            .mockRejectedValueOnce(new Error('temporary status failure'))
            .mockResolvedValueOnce({ id: 'order-1', status: 'completed' })
        const { result } = setup(walletA, onConfirmed)
        await waitForConfig(result)
        vi.useFakeTimers()

        await act(async () => {
            await result.current.start()
        })
        expect(result.current.order?.id).toBe('order-1')

        await act(() => vi.advanceTimersByTimeAsync(3_000))
        expect(result.current.phase).not.toBe('failed')
        expect(result.current.lastPollError?.message).toBe('temporary status failure')

        await act(() => vi.advanceTimersByTimeAsync(3_000))
        expect(mocks.fetchOrder).toHaveBeenCalledTimes(2)
        expect(result.current.phase).toBe('completed')
        expect(result.current.lastPollError).toBeNull()
        expect(onConfirmed).toHaveBeenCalledTimes(1)
    })

    it('uses a cross-chain order factory and reports the source hash before completion', async () => {
        const onSubmitted = vi.fn()
        const onConfirmed = vi.fn()
        const createOrder = vi.fn().mockResolvedValue({
            id: 'cross-order',
            status: 'quoted',
        })
        mocks.fetchOrder
            .mockResolvedValueOnce({
                id: 'cross-order',
                status: 'swap-submitted',
                swapTransactionHash: `0x${'12'.repeat(32)}`,
            })
            .mockResolvedValueOnce({
                id: 'cross-order',
                status: 'completed',
                swapTransactionHash: `0x${'12'.repeat(32)}`,
            })
        const { result } = setup(walletA, onConfirmed, {
            createOrder,
            onSubmitted,
        })
        await waitForConfig(result)
        vi.useFakeTimers()

        await act(async () => result.current.start())
        expect(createOrder).toHaveBeenCalledOnce()
        expect(mocks.createOrder).not.toHaveBeenCalled()

        await act(() => vi.advanceTimersByTimeAsync(3_000))
        expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({
            status: 'swap-submitted',
        }))
        expect(onConfirmed).not.toHaveBeenCalled()

        await act(() => vi.advanceTimersByTimeAsync(3_000))
        expect(onSubmitted).toHaveBeenCalledTimes(1)
        expect(onConfirmed).toHaveBeenCalledWith(expect.objectContaining({
            status: 'completed',
        }))
    })

    it('does not publish an order authenticated for a disconnected wallet', async () => {
        let resolveAuthentication
        mocks.authenticate.mockImplementation(() => new Promise((resolve) => {
            resolveAuthentication = resolve
        }))
        const { result, rerender } = setup()
        await waitForConfig(result)
        let pendingStart
        await act(async () => {
            pendingStart = result.current.start()
            await Promise.resolve()
        })
        rerender({ wallet: walletB, inputOverrides: {} })
        await act(async () => resolveAuthentication({ sessionToken: 'stale-session' }))
        await act(async () => pendingStart)

        expect(mocks.createOrder).not.toHaveBeenCalled()
        expect(result.current.order).toBeNull()
        expect(result.current.phase).toBe('idle')
    })

    it('reports missing or invalid input instead of remaining stuck on authenticating', async () => {
        const { result } = setup(walletA, vi.fn(), { grossInputAmount: '0' })
        await waitForConfig(result)

        await act(async () => {
            await result.current.start()
        })

        expect(result.current.phase).toBe('failed')
        expect(result.current.error).toMatchObject({ code: 'SWAP_AMOUNT_INVALID' })
    })

    it('ignores duplicate package clicks while the first preparation is active', async () => {
        let resolvePackage
        mocks.preparePackage.mockImplementation(() => new Promise((resolve) => {
            resolvePackage = resolve
        }))
        const { result } = setup()
        await waitForConfig(result)
        await act(async () => {
            await result.current.start()
        })

        let first
        await act(async () => {
            first = result.current.signPackage()
            result.current.signPackage()
            await Promise.resolve()
        })
        expect(mocks.preparePackage).toHaveBeenCalledTimes(1)

        await act(async () => resolvePackage({
            orderId: 'order-1',
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
            transactions: [],
        }))
        await act(async () => first)
        expect(mocks.signPackage).toHaveBeenCalledTimes(1)
    })

    it('shows a cross-chain preview without authentication and authenticates once on confirmation', async () => {
        const events = []
        const beforeAuthenticate = vi.fn(async () => events.push('cross-chain-auth'))
        mocks.authenticate.mockImplementation(async () => {
            events.push('sponsorship-auth')
            return { sessionToken: 'session' }
        })
        const createOrder = vi.fn(async () => {
            events.push('create-order')
            return { id: 'exact-order', status: 'quoted' }
        })
        mocks.preparePackage.mockImplementation(async () => {
            events.push('prepare-package')
            return {
                orderId: 'exact-order',
                expiresAt: new Date(Date.now() + 900_000).toISOString(),
                transactions: [],
            }
        })
        const { result } = setup(walletA, vi.fn(), {
            createOrder,
            beforeAuthenticate,
        })
        await waitForConfig(result)

        act(() => result.current.reviewOrder({
            id: 'preview:route-1',
            isPreview: true,
            walletAddress: walletA,
            status: 'preview',
        }))

        expect(result.current.phase).toBe('review')
        expect(mocks.authenticate).not.toHaveBeenCalled()
        expect(createOrder).not.toHaveBeenCalled()

        await act(async () => result.current.signPackage())

        expect(events).toEqual([
            'cross-chain-auth',
            'sponsorship-auth',
            'create-order',
            'prepare-package',
        ])
        expect(mocks.authenticate).toHaveBeenCalledOnce()
        expect(createOrder).toHaveBeenCalledOnce()
        expect(mocks.signPackage).toHaveBeenCalledOnce()
    })

    it('never polls a temporary cross-chain preview when exact order creation fails', async () => {
        const createOrder = vi.fn().mockRejectedValue(new Error('prepare failed'))
        const { result } = setup(walletA, vi.fn(), {
            createOrder,
            beforeAuthenticate: vi.fn(),
        })
        await waitForConfig(result)
        vi.useFakeTimers()

        act(() => result.current.reviewOrder({
            id: 'preview:route-1',
            isPreview: true,
            walletAddress: walletA,
            status: 'preview',
        }))

        await act(async () => result.current.signPackage())
        expect(result.current.phase).toBe('failed')

        await act(() => vi.advanceTimersByTimeAsync(10_000))
        expect(mocks.fetchOrder).not.toHaveBeenCalled()
    })

    it('exposes no external wallet signer state', async () => {
        const { result } = setup()
        await waitForConfig(result)
        expect(result.current.capability.transport).toBe('pistachio-local')
        expect(result.current.metaMaskSigner).toBeNull()
    })
})
