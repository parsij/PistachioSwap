// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    recover: vi.fn(),
    fetchConfig: vi.fn(),
    authenticate: vi.fn(),
    createOrder: vi.fn(),
    fetchOrder: vi.fn(),
    cancelOrder: vi.fn(),
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
    cancelSponsorshipOrder: mocks.cancelOrder,
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
        mocks.cancelOrder.mockResolvedValue({ cancelled: true, status: 'cancelled' })
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

    it('authenticates and creates the final quote before showing review, with no second quote-confirmation', async () => {
        const order = {
            id: 'order-final', isPreview: false, walletAddress: walletA,
            chainId: 56, sellToken: tokenA.address, buyToken: tokenB.address,
            grossInputAmountRaw: '1000', netSwapAmountRaw: '900',
            paymentToken: tokenA.address, paymentAmountRaw: '110',
            totalPrepaymentUsdMicros: '110000', expectedOutputRaw: '850',
            minimumOutputRaw: '800',
        }
        mocks.createOrder.mockResolvedValueOnce(order)
        const { result } = setup()
        await waitForConfig(result)
        await act(() => result.current.start())

        expect(mocks.authenticate).toHaveBeenCalledOnce()
        expect(mocks.createOrder).toHaveBeenCalledOnce()
        expect(result.current.phase).toBe('review')
        expect(result.current.order).toEqual(order)
        expect(result.current.reviewUpdated).toBe(false)
        expect(mocks.prepareSelfHosted).not.toHaveBeenCalled()

        await act(() => result.current.signPackage())
        expect(mocks.createOrder).toHaveBeenCalledOnce()
        expect(mocks.prepareSelfHosted).toHaveBeenCalledOnce()
        expect(mocks.submitSelfHosted).toHaveBeenCalledOnce()
        expect(result.current.reviewUpdated).toBe(false)
    })

    it('releases an abandoned authenticated review without signing or spending', async () => {
        const { result } = setup()
        await waitForConfig(result)
        await act(() => result.current.start())
        expect(result.current.phase).toBe('review')
        act(() => result.current.close())
        await waitFor(() => expect(mocks.cancelOrder).toHaveBeenCalledWith(
            '/v1/quote', 'session', 'order-1',
        ))
        expect(result.current.phase).toBe('idle')
        expect(mocks.prepareSelfHosted).not.toHaveBeenCalled()
        expect(mocks.submitSelfHosted).not.toHaveBeenCalled()
    })

    it('waits for abandoned order cancellation before creating another final quote', async () => {
        let finishCancellation
        mocks.cancelOrder.mockImplementationOnce(() => new Promise(resolve => {
            finishCancellation = resolve
        }))
        const { result } = setup()
        await waitForConfig(result)
        await act(() => result.current.start())
        act(() => result.current.close())
        expect(mocks.cancelOrder).toHaveBeenCalledOnce()

        let reopening
        act(() => { reopening = result.current.start() })
        expect(mocks.authenticate).toHaveBeenCalledOnce()
        expect(mocks.createOrder).toHaveBeenCalledOnce()
        await act(async () => {
            finishCancellation({ cancelled: true })
            await reopening
        })
        expect(mocks.authenticate).toHaveBeenCalledTimes(2)
        expect(mocks.createOrder).toHaveBeenCalledTimes(2)
        expect(result.current.phase).toBe('review')
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

    it.each([false, true])('requires a second review for a higher final charge (one-confirmation=%s)', async (oneConfirmationEnabled) => {
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
        const { result } = setup(walletA, vi.fn(), { previewOrder, oneConfirmationEnabled })
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

    it('continues within confirmed output/fee limits with the combined review enabled', async () => {
        const previewOrder = {
            id: 'preview-bounded', isPreview: true, walletAddress: walletA,
            chainId: 56, sellToken: tokenA.address, buyToken: tokenB.address,
            grossInputAmountRaw: '1000', netSwapAmountRaw: '900',
            paymentToken: tokenA.address, paymentAmountRaw: '100',
            totalPrepaymentUsdMicros: '100000', expectedOutputRaw: '850', minimumOutputRaw: '800',
        }
        mocks.createOrder.mockResolvedValue({ ...previewOrder, id: 'order-1', isPreview: false, expectedOutputRaw: '849' })
        const { result } = setup(walletA, vi.fn(), { previewOrder, oneConfirmationEnabled: true })
        await waitForConfig(result)
        await act(() => result.current.start())
        await act(() => result.current.signPackage())
        expect(mocks.submitSelfHosted).toHaveBeenCalledOnce()
        expect(mocks.submitSelfHosted).toHaveBeenCalledWith(expect.objectContaining({
            useSingleConfirmation: true, allowDelegationMigration: true,
        }))
        expect(result.current.reviewUpdated).toBe(false)
    })

    it.each([false, true])('allows wallet-reviewed delegation replacement (one-confirmation=%s)', async (oneConfirmationEnabled) => {
        const { result } = setup(walletA, vi.fn(), { oneConfirmationEnabled })
        await waitForConfig(result)
        await act(async () => { await result.current.start() })
        await act(async () => { await result.current.signPackage() })
        expect(mocks.submitSelfHosted).toHaveBeenCalledWith(expect.objectContaining({
            allowDelegationMigration: true,
            useSingleConfirmation: oneConfirmationEnabled,
        }))
        expect(mocks.cancelOrder).not.toHaveBeenCalled()
    })

    it('cancels an unsigned order after wallet rejection so retry can create a new order', async () => {
        mocks.submitSelfHosted.mockRejectedValueOnce(Object.assign(new Error('Rejected'), { code: 4001 }))
        const { result } = setup()
        await waitForConfig(result)
        await act(async () => { await result.current.start() })
        await act(async () => { await result.current.signPackage() })
        expect(mocks.cancelOrder).toHaveBeenCalledWith('/v1/quote', 'session', 'order-1')
        expect(result.current.phase).toBe('cancelled')
        await act(async () => { await result.current.start() })
        expect(mocks.createOrder).toHaveBeenCalledTimes(2)
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
    afterEach(() => {
        localStorage.clear()
        vi.unstubAllGlobals()
    })

    const routeId = '11111111-1111-4111-8111-111111111111'
    const transactionHash = `0x${'cd'.repeat(32)}`
    const setCrossChainRecovery = (dismissed = false) => {
        localStorage.setItem('pistachioswap:pending-userops:v1', JSON.stringify([{
            orderId: 'recovery-order', walletAddress: wallet, userOpHash,
            chainId: 137, timestamp: Date.now(), routeId, dismissed,
            reviewDisplay: {
                grossInputAmountRaw: '1200000', expectedOutputRaw: '1193997',
                paymentAmountRaw: '3954', sellTokenDecimals: 6,
                buyTokenDecimals: 6, paymentTokenDecimals: 6,
                sellTokenSymbol: 'USDC', buyTokenSymbol: 'USDC',
                paymentTokenSymbol: 'USDC', totalPrepaymentUsdMicros: '3954',
            },
        }]))
    }
    const sourceRecovered = () => ({
        orderId: 'recovery-order', walletAddress: wallet, userOpHash,
        chainId: 137, sourceStatus: 'confirmed',
        transactionHash, status: 'completed',
    })

    it('marks a cross-chain operation complete only after the bound provider reports settlement', async () => {
        setCrossChainRecovery()
        mocks.recover.mockResolvedValue(sourceRecovered())
        const fetch = vi.fn(async () => new Response(JSON.stringify({
            destination: {
                publicRouteId: routeId, sourceChainId: 137,
                sourceTransactionHash: transactionHash, status: 'completed',
            },
        })))
        vi.stubGlobal('fetch', fetch)
        const onConfirmed = vi.fn()
        const hook = renderHook(() => usePrepaidSponsorship({
            quoteEndpoint: '/api/v1/quote', walletAddress: wallet,
            recoveryKind: 'cross-chain', onConfirmed,
        }))
        await waitFor(() => expect(hook.result.current.phase).toBe('completed'))
        expect(hook.result.current.order.reviewDisplay).toMatchObject({
            grossInputAmountRaw: '1200000',
            expectedOutputRaw: '1193997',
            paymentAmountRaw: '3954',
        })
        expect(onConfirmed).toHaveBeenCalledOnce()
        expect(JSON.parse(localStorage.getItem('pistachioswap:pending-userops:v1'))).toEqual([])
        hook.unmount()
    })

    it('never treats recovered source confirmation as a newly submitted swap during a fresh quote', async () => {
        setCrossChainRecovery(true)
        mocks.recover.mockResolvedValue(sourceRecovered())
        const onSubmitted = vi.fn()
        const onRecovered = vi.fn()
        const completeRoute = vi.fn()
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            destination: {
                publicRouteId: routeId,
                sourceChainId: 137,
                sourceTransactionHash: transactionHash,
                status: 'in-flight',
            },
        }))))
        const hook = renderHook(() => usePrepaidSponsorship({
            quoteEndpoint: '/api/v1/quote', walletAddress: wallet,
            recoveryKind: 'cross-chain', onSubmitted, onRecovered,
            onConfirmed: completeRoute,
        }))
        await waitFor(() => expect(hook.result.current.phase).toBe('destination-pending'))
        expect(onRecovered).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'recovery-order',
                recoveredFromStorage: true,
                swapTransactionHash: transactionHash,
            }),
            'destination-pending',
        )
        expect(onSubmitted).not.toHaveBeenCalled()
        expect(completeRoute).not.toHaveBeenCalled()
        expect(mocks.submitSelfHosted).not.toHaveBeenCalled()
        expect(mocks.createOrder).not.toHaveBeenCalled()
        hook.unmount()
    })

    it('does not replace a new review with an older operation during recovery polling', async () => {
        setCrossChainRecovery(true)
        mocks.recover.mockResolvedValue(sourceRecovered())
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            destination: {
                publicRouteId: routeId, sourceChainId: 137,
                sourceTransactionHash: transactionHash, status: 'in-flight',
            },
        }))))
        const hook = renderHook(() => usePrepaidSponsorship({
            quoteEndpoint: '/api/v1/quote', walletAddress: wallet,
            recoveryKind: 'cross-chain',
        }))
        await waitFor(() => expect(hook.result.current.phase).toBe('destination-pending'))
        await act(async () => hook.result.current.start())
        expect(hook.result.current.phase).toBe('unsupported')
        expect(hook.result.current.order).toBeNull()
        expect(hook.result.current.error.code).toBe('PREVIOUS_OPERATION_PENDING')
        expect(mocks.authenticate).not.toHaveBeenCalled()
        expect(mocks.createOrder).not.toHaveBeenCalled()
        expect(mocks.submitSelfHosted).not.toHaveBeenCalled()
        hook.unmount()
    })

    it('keeps a source-only completed operation pending until destination settlement is verified', async () => {
        setCrossChainRecovery()
        mocks.recover.mockResolvedValue(sourceRecovered())
        const fetch = vi.fn(async () => new Response(JSON.stringify({
            destination: {
                publicRouteId: routeId, sourceChainId: 137,
                sourceTransactionHash: transactionHash, status: 'in-flight',
            },
        })))
        vi.stubGlobal('fetch', fetch)
        const hook = renderHook(() => usePrepaidSponsorship({
            quoteEndpoint: '/api/v1/quote', walletAddress: wallet,
            recoveryKind: 'cross-chain',
        }))
        await waitFor(() => expect(hook.result.current.phase).toBe('destination-pending'))
        expect(hook.result.current.order.status).toBe('atomic-submitted')
        expect(JSON.parse(localStorage.getItem('pistachioswap:pending-userops:v1'))).toHaveLength(1)
        hook.unmount()
    })

    it('does not accept a completed route with a mismatched source transaction', async () => {
        setCrossChainRecovery()
        mocks.recover.mockResolvedValue(sourceRecovered())
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            destination: {
                publicRouteId: routeId, sourceChainId: 137,
                sourceTransactionHash: `0x${'ef'.repeat(32)}`, status: 'completed',
            },
        }))))
        const hook = renderHook(() => usePrepaidSponsorship({
            quoteEndpoint: '/api/v1/quote', walletAddress: wallet,
            recoveryKind: 'cross-chain',
        }))
        await waitFor(() => expect(hook.result.current.phase).toBe('destination-pending'))
        expect(hook.result.current.order.status).toBe('atomic-submitted')
        hook.unmount()
    })

    it('remembers a dismissed submitted operation while continuing recovery in the background', async () => {
        setCrossChainRecovery(true)
        mocks.recover.mockResolvedValue({
            ...sourceRecovered(), sourceStatus: 'pending', status: 'pending',
        })
        const hook = renderHook(() => usePrepaidSponsorship({
            quoteEndpoint: '/api/v1/quote', walletAddress: wallet,
            recoveryKind: 'cross-chain',
        }))
        await waitFor(() => expect(mocks.recover).toHaveBeenCalled())
        expect(hook.result.current.open).toBe(false)
        expect(hook.result.current.order.reviewDisplay.paymentAmountRaw).toBe('3954')
        expect(hook.result.current.order.userOpHash).toBe(userOpHash)
        expect(mocks.submitSelfHosted).not.toHaveBeenCalled()
        hook.unmount()
    })

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
