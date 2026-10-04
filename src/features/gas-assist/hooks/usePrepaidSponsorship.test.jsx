// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    recover: vi.fn(),
    fetchConfig: vi.fn(),
    authenticate: vi.fn(),
    createOrder: vi.fn(),
    fetchOrder: vi.fn(),
    prepareSelfHosted: vi.fn(),
    submitSelfHosted: vi.fn(),
}))

vi.mock('#wallet-runtime', () => ({
    useConnection: () => ({ connector: { id: 'pistachio-local' } }),
    useWalletClient: () => ({
        data: {
            account: { address: '0x1' },
            request: vi.fn(),
            signTypedData: vi.fn(),
            signMessage: vi.fn(),
        },
    }),
}))

vi.mock('../services/prepaidSponsorship.js', () => ({
    fetchSponsorshipConfig: mocks.fetchConfig,
    authenticateSponsorshipWallet: mocks.authenticate,
    createSponsorshipOrder: mocks.createOrder,
    fetchSponsorshipOrder: mocks.fetchOrder,
}))

vi.mock('../services/selfHostedPaymaster.js', () => ({
    recoverSelfHostedUserOperation: mocks.recover,
    selfHostedFrontendEnabled: (config) =>
        config?.enabled === true &&
        config?.provider === 'pistachio-paymaster-v08' &&
        config?.execution === 'erc4337-v08-eip7702-direct',
    prepareSelfHostedSponsorship: mocks.prepareSelfHosted,
    submitSelfHostedPaymasterUserOperation: mocks.submitSelfHosted,
}))

import { reviewedSponsorshipOrderChanged, usePrepaidSponsorship } from './usePrepaidSponsorship.js'

const walletA = '0x0000000000000000000000000000000000000001'
const walletB = '0x0000000000000000000000000000000000000002'
const tokenA = { address: '0x0000000000000000000000000000000000000011' }
const tokenB = { address: '0x0000000000000000000000000000000000000012' }

const activeConfig = {
    enabled: true,
    provider: 'pistachio-paymaster-v08',
    execution: 'erc4337-v08-eip7702-direct',
}

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
    await waitFor(() => expect(result.current.config).toEqual(activeConfig))
}

describe('reviewed sponsorship order binding', () => {
    const reviewed = {
        id: 'preview-1',
        isPreview: true,
        walletAddress: walletA,
        chainId: 56,
        sellToken: tokenA.address,
        buyToken: tokenB.address,
        grossInputAmountRaw: '1000',
        netSwapAmountRaw: '900',
        paymentToken: tokenA.address,
        paymentAmountRaw: '100',
        paymentTokenDecimals: 18,
        totalPrepaymentUsdMicros: '100000',
        expectedOutputRaw: '850',
        minimumOutputRaw: '800',
        approvalSpender: '0x0000000000000000000000000000000000000020',
        approvalAmountRaw: '900',
        quoteProvider: 'uniswap',
        sponsoredFlow: 'normal-sponsored-swap',
        billingMode: 'prepaid',
    }

    it('ignores lifecycle-only fields but detects reviewed economic or route changes', () => {
        expect(reviewedSponsorshipOrderChanged(reviewed, {
            ...reviewed,
            id: 'order-1',
            isPreview: false,
            status: 'quoted',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })).toBe(false)

        expect(reviewedSponsorshipOrderChanged(reviewed, {
            ...reviewed,
            id: 'order-1',
            isPreview: false,
            paymentAmountRaw: '101',
        })).toBe(true)

        expect(reviewedSponsorshipOrderChanged(reviewed, {
            ...reviewed,
            id: 'order-1',
            isPreview: false,
            minimumOutputRaw: '799',
        })).toBe(true)
    })
})

describe('self-hosted sponsorship async ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.fetchConfig.mockResolvedValue(activeConfig)
        mocks.authenticate.mockResolvedValue({ sessionToken: 'session' })
        mocks.createOrder.mockResolvedValue({ id: 'order-1', status: 'quoted' })
        mocks.prepareSelfHosted.mockResolvedValue({
            orderId: 'order-1',
            provider: 'pistachio-paymaster-v08',
            execution: 'erc4337-v08-eip7702-direct',
            stage: 'direct',
            paymentMode: 'sponsored',
            chainId: 56,
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
            transactions: [],
        })
        mocks.submitSelfHosted.mockResolvedValue({
            orderId: 'order-1',
            userOpHash: `0x${'1'.repeat(64)}`,
            transactionHash: `0x${'2'.repeat(64)}`,
            status: 'source-confirmed',
        })
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

    it('surfaces the backend rejection code when order polling reports a failed swap', async () => {
        mocks.fetchOrder.mockResolvedValue({
            id: 'order-1',
            status: 'failed',
            safeErrorCode: 'PAYMASTER_EXECUTION_REVERTED',
        })
        const { result } = setup()
        await waitForConfig(result)
        vi.useFakeTimers()

        await act(async () => {
            await result.current.start()
        })
        await act(() => vi.advanceTimersByTimeAsync(3_000))

        expect(result.current.phase).toBe('failed')
        expect(result.current.error).toMatchObject({
            code: 'PAYMASTER_EXECUTION_REVERTED',
            details: {
                stage: 'order.poll',
                status: 'failed',
                rejectionCode: 'PAYMASTER_EXECUTION_REVERTED',
            },
        })
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

    it('ignores duplicate package clicks while self-hosted preparation is active', async () => {
        let resolvePrepared
        mocks.prepareSelfHosted.mockImplementation(() => new Promise((resolve) => {
            resolvePrepared = resolve
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
        expect(mocks.prepareSelfHosted).toHaveBeenCalledTimes(1)

        await act(async () => resolvePrepared({
            orderId: 'order-1',
            provider: 'pistachio-paymaster-v08',
            execution: 'erc4337-v08-eip7702-direct',
            stage: 'direct',
            paymentMode: 'sponsored',
            chainId: 56,
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
            transactions: [],
        }))
        await act(async () => first)
        expect(mocks.submitSelfHosted).toHaveBeenCalledTimes(1)
    })

    it('requires a second review when the final order differs from the preview', async () => {
        const previewOrder = {
            id: 'preview-1',
            isPreview: true,
            walletAddress: walletA,
            chainId: 56,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            grossInputAmountRaw: '1000',
            netSwapAmountRaw: '900',
            paymentToken: tokenA.address,
            paymentAmountRaw: '100',
            paymentTokenDecimals: 18,
            totalPrepaymentUsdMicros: '100000',
            expectedOutputRaw: '850',
            minimumOutputRaw: '800',
            approvalSpender: '0x0000000000000000000000000000000000000020',
            approvalAmountRaw: '900',
            quoteProvider: 'uniswap',
            sponsoredFlow: 'normal-sponsored-swap',
            billingMode: 'prepaid',
        }
        mocks.createOrder.mockResolvedValue({
            ...previewOrder,
            id: 'order-1',
            isPreview: false,
            paymentAmountRaw: '101',
        })
        const { result } = setup(walletA, vi.fn(), { previewOrder })
        await waitForConfig(result)

        await act(async () => {
            await result.current.start()
        })
        await act(async () => {
            await result.current.signPackage()
        })

        expect(result.current.phase).toBe('review')
        expect(result.current.order.id).toBe('order-1')
        expect(result.current.order.paymentAmountRaw).toBe('101')
        expect(result.current.reviewUpdated).toBe(true)
        expect(mocks.prepareSelfHosted).not.toHaveBeenCalled()
        expect(mocks.submitSelfHosted).not.toHaveBeenCalled()
    })

    it('fails closed when the self-hosted provider is unavailable', async () => {
        mocks.fetchConfig.mockResolvedValue({
            enabled: true,
            provider: 'particle',
            execution: 'browser-direct',
        })
        const { result } = setup()
        await waitFor(() => expect(result.current.config?.provider).toBe('particle'))

        await act(async () => {
            await result.current.start()
        })

        expect(result.current.phase).toBe('failed')
        expect(result.current.error).toMatchObject({ code: 'SELF_HOSTED_PAYMASTER_UNAVAILABLE' })
        expect(mocks.prepareSelfHosted).not.toHaveBeenCalled()
    })

    it('uses only the self-hosted submission path', async () => {
        const onConfirmed = vi.fn()
        const { result } = setup(walletA, onConfirmed)
        await waitForConfig(result)

        await act(async () => {
            await result.current.start()
        })
        await act(async () => {
            await result.current.signPackage()
        })

        expect(mocks.prepareSelfHosted).toHaveBeenCalledTimes(1)
        expect(mocks.submitSelfHosted).toHaveBeenCalledTimes(1)
        expect(result.current.phase).toBe('completed')
        expect(onConfirmed).toHaveBeenCalledTimes(1)
    })
})

describe('refresh recovery from public identifiers', () => {
    const wallet = '0x1111111111111111111111111111111111111111'
    const userOpHash = `0x${'ab'.repeat(32)}`
    beforeEach(() => {
        vi.clearAllMocks()
        localStorage.clear()
        localStorage.setItem('pistachioswap:pending-userops:v1', JSON.stringify([{
            orderId: 'recovery-order', walletAddress: wallet, userOpHash,
            chainId: 56, timestamp: Date.now() - 130_000,
        }]))
        mocks.fetchConfig.mockResolvedValue(activeConfig)
    })
    afterEach(() => localStorage.clear())
    it('survives refresh and close without signing or sending again', async () => {
        mocks.recover.mockResolvedValue({ orderId: 'recovery-order', walletAddress: wallet,
            userOpHash, chainId: 56, status: 'atomic-submitting', sourceStatus: 'pending' })
        const first = renderHook(() => usePrepaidSponsorship({ quoteEndpoint: '/api/v1/quote', walletAddress: wallet }))
        await waitFor(() => expect(first.result.current.phase).toBe('confirmation-delayed'))
        act(() => first.result.current.close())
        expect(first.result.current.open).toBe(false)
        expect(JSON.parse(localStorage.getItem('pistachioswap:pending-userops:v1'))).toHaveLength(1)
        first.unmount()
        mocks.recover.mockResolvedValue({ orderId: 'recovery-order', walletAddress: wallet,
            userOpHash, chainId: 56, transactionHash: `0x${'cd'.repeat(32)}`, status: 'completed', sourceStatus: 'confirmed' })
        const second = renderHook(() => usePrepaidSponsorship({ quoteEndpoint: '/api/v1/quote', walletAddress: wallet }))
        await waitFor(() => expect(second.result.current.phase).toBe('completed'))
        expect(mocks.submitSelfHosted).not.toHaveBeenCalled()
        expect(mocks.authenticate).not.toHaveBeenCalled()
        expect(JSON.parse(localStorage.getItem('pistachioswap:pending-userops:v1'))).toEqual([])
        second.unmount()
    })
    it('keeps transient receipt failures pending', async () => {
        mocks.recover.mockRejectedValue(new Error('RPC unavailable'))
        const hook = renderHook(() => usePrepaidSponsorship({ quoteEndpoint: '/api/v1/quote', walletAddress: wallet }))
        await waitFor(() => expect(mocks.recover).toHaveBeenCalled())
        expect(hook.result.current.phase).toBe('confirmation-delayed')
        expect(hook.result.current.error).toBeNull()
        hook.unmount()
    })
})
