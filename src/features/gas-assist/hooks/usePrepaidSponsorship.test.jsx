// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    fetchConfig: vi.fn(),
    authenticate: vi.fn(),
    createOrder: vi.fn(),
    fetchOrder: vi.fn(),
}))

vi.mock('wagmi', () => ({
    useConnection: () => ({ connector: { id: 'test' } }),
    useWalletClient: () => ({ data: { account: { address: '0x1' } } }),
}))

vi.mock('../services/prepaidSponsorship.js', () => ({
    fetchSponsorshipConfig: mocks.fetchConfig,
    authenticateSponsorshipWallet: mocks.authenticate,
    createSponsorshipOrder: mocks.createOrder,
    fetchSponsorshipOrder: mocks.fetchOrder,
    prepareSponsorshipApproval: vi.fn(),
    prepareSponsorshipContinuation: vi.fn(),
    prepareSponsorshipPayment: vi.fn(),
    signAndSubmitPrepaidZeroX: vi.fn(),
    submitSponsorshipIntent: vi.fn(),
}))

vi.mock('../services/rawTransactionSigning.js', () => ({
    detectRawTransactionSigning: () => ({
        rawTransactionSigningSupported: true,
        transport: 'wallet-client',
        account: null,
    }),
    signPreparedSponsoredTransaction: vi.fn(),
}))

vi.mock('./useMetaMaskMultichainSigner.js', () => ({
    useMetaMaskMultichainSigner: () => ({
        isMetaMask: false,
        capability: { status: 'disabled', rawTransactionSigningSupported: false },
    }),
}))

import { usePrepaidSponsorship } from './usePrepaidSponsorship.js'

const walletA = '0x0000000000000000000000000000000000000001'
const walletB = '0x0000000000000000000000000000000000000002'
const tokenA = { address: '0x0000000000000000000000000000000000000011' }
const tokenB = { address: '0x0000000000000000000000000000000000000012' }

function setup(walletAddress = walletA, onConfirmed = vi.fn()) {
    return renderHook(({ wallet }) => usePrepaidSponsorship({
        quoteEndpoint: '/v1/quote',
        walletAddress: wallet,
        sellToken: tokenA,
        buyToken: tokenB,
        grossInputAmount: '1000',
        slippageBps: 50,
        required: true,
        onConfirmed,
    }), { initialProps: { wallet: walletAddress } })
}

describe('prepaid sponsorship async ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.fetchConfig.mockResolvedValue({ enabled: true })
        mocks.authenticate.mockResolvedValue({ sessionToken: 'session' })
        mocks.createOrder.mockResolvedValue({ id: 'order-1', status: 'awaiting-payment' })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('continues order polling after a transient status failure', async () => {
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
        await act(() => vi.advanceTimersByTimeAsync(3_000))

        expect(mocks.fetchOrder).toHaveBeenCalledTimes(2)
        expect(result.current.phase).toBe('completed')
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
        rerender({ wallet: walletB })
        await act(async () => resolveAuthentication({ sessionToken: 'stale-session' }))
        await act(async () => pendingStart)

        expect(mocks.createOrder).not.toHaveBeenCalled()
        expect(result.current.order).toBeNull()
        expect(result.current.phase).toBe('idle')
    })
})
