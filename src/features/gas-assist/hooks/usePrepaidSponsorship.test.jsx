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
        vi.useFakeTimers()
        const onConfirmed = vi.fn()
        mocks.fetchOrder
            .mockRejectedValueOnce(new Error('temporary status failure'))
            .mockResolvedValueOnce({ id: 'order-1', status: 'completed' })
        const { result } = setup(walletA, onConfirmed)
        await act(async () => Promise.resolve())
        await act(() => result.current.start())
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

    it('does not publish an order authenticated for a disconnected wallet', async () => {
        let resolveAuthentication
        mocks.authenticate.mockImplementation(() => new Promise((resolve) => {
            resolveAuthentication = resolve
        }))
        const { result, rerender } = setup()
        await waitFor(() => expect(result.current.config).toEqual({ enabled: true }))
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
        await waitFor(() => expect(result.current.config).toEqual({ enabled: true }))

        await act(() => result.current.start())

        expect(result.current.phase).toBe('failed')
        expect(result.current.error).toMatchObject({ code: 'SWAP_AMOUNT_INVALID' })
    })

    it('ignores duplicate package clicks while the first preparation is active', async () => {
        let resolvePackage
        mocks.preparePackage.mockImplementation(() => new Promise((resolve) => {
            resolvePackage = resolve
        }))
        const { result } = setup()
        await waitFor(() => expect(result.current.config).toEqual({ enabled: true }))
        await act(() => result.current.start())

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

    it('exposes no external wallet signer state', async () => {
        const { result } = setup()
        await waitFor(() => expect(result.current.config).toEqual({ enabled: true }))
        expect(result.current.capability.transport).toBe('pistachio-local')
        expect(result.current.metaMaskSigner).toBeNull()
    })
})
