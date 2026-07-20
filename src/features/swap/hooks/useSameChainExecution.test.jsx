// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const simulation = vi.fn()

import { useSameChainExecution } from './useSameChainExecution.js'

const ACCOUNT = '0x0000000000000000000000000000000000000001'
const SELL = '0x0000000000000000000000000000000000000002'
const BUY = '0x0000000000000000000000000000000000000003'
const PERMIT2 = '0x0000000000000000000000000000000000000004'
const ROUTER = '0x0000000000000000000000000000000000000005'
const request = { chainId: 56, sellToken: SELL, buyToken: BUY, takerAddress: ACCOUNT, mode: 'EXACT_INPUT', sellAmount: '100', buyAmount: null, slippageBps: 50 }
const snapshot = { requestKey: 'request-key', inputKey: 'input-key', slippageBps: 50, request }

function quote(data = '0x1234') {
    return { approvalSchemaVersion: 1, selectedQuote: { provider: 'pancakeswap', chainId: 56, sellToken: SELL, buyToken: BUY, mode: 'EXACT_INPUT', sellAmount: '100', buyAmount: '200', expiresAt: '2999-01-01T00:00:00.000Z', allowanceTarget: PERMIT2, transaction: { to: ROUTER, data, value: '0' }, approval: { mode: 'permit2-allowance', contract: PERMIT2, spender: ROUTER, token: SELL, requiredAmount: '100' } } }
}

function simulationFailure(errorName) {
    const error = new Error(errorName)
    error.decoded = { errorName }
    return error
}

function setup(overrides = {}) {
    const dependencies = {
        prepareSwapApproval: vi.fn().mockResolvedValue(true),
        getLastPreparationResult: vi.fn(() => ({ approvalReady: true, approvalTransactionSubmitted: false })),
        invalidatePermit2Readiness: vi.fn(),
        fetchQuote: vi.fn().mockResolvedValue(quote('0xabcd')),
        applyRefreshedQuote: vi.fn(),
        sendTransaction: vi.fn().mockResolvedValue(`0x${'11'.repeat(32)}`),
        setReviewOperation: vi.fn(), setReviewError: vi.fn(), setVisibleStatus: vi.fn(),
        setTransactionStatus: vi.fn(), setTransactionHash: vi.fn(), setReviewConfirmationPending: vi.fn(), diagnostic: vi.fn(),
        ...overrides,
    }
    const config = {
        account: ACCOUNT, chainId: 56, sellToken: { address: SELL }, buyToken: { address: BUY },
        quote: quote(), quoteSnapshot: snapshot, quoteEndpoint: '/v1/quote',
        requireSuccessfulSimulation: true, publicClient: {}, simulateTransaction: simulation, transactionStatus: 'idle', reviewOperation: 'idle',
        getCurrentRequestKey: () => snapshot.requestKey, requestKeySuffix: (value) => value,
        quoteDiagnostic: (value) => value, approvalMetadataDiagnostic: (value) => value,
        transactionDiagnostic: (value) => value, executionErrorSnapshot: (value) => ({ message: value?.message }),
        ...dependencies,
    }
    const view = renderHook(() => useSameChainExecution(config))
    return { ...view, dependencies }
}

describe('same-chain execution orchestration with mocked approval, quote, simulation, and wallet dependencies', () => {
    beforeEach(() => simulation.mockReset().mockResolvedValue(undefined))

    it('prevents duplicate confirmation and clears pending state after submission', async () => {
        let release
        const prepareSwapApproval = vi.fn(() => new Promise((resolve) => { release = resolve }))
        const { result, dependencies } = setup({ prepareSwapApproval })
        let first
        await act(async () => {
            first = result.current.confirmSameChainSwap()
            await expect(result.current.confirmSameChainSwap()).resolves.toBeNull()
            release(true)
            await first
        })
        expect(prepareSwapApproval).toHaveBeenCalledTimes(1)
        expect(dependencies.sendTransaction).toHaveBeenCalledTimes(1)
        expect(result.current.isConfirming).toBe(false)
    })

    it('force-refreshes after an approval transaction and simulates refreshed calldata', async () => {
        const { result, dependencies } = setup({ getLastPreparationResult: vi.fn(() => ({ approvalReady: true, approvalTransactionSubmitted: true })) })
        await act(() => result.current.confirmSameChainSwap())
        expect(dependencies.fetchQuote).toHaveBeenCalledWith(expect.objectContaining({ forceRefresh: true }))
        expect(simulation).toHaveBeenCalledWith(expect.objectContaining({ transaction: expect.objectContaining({ data: '0xabcd' }) }))
        expect(dependencies.sendTransaction).toHaveBeenCalledTimes(1)
    })

    it('does not refresh when approval was already ready', async () => {
        const { result, dependencies } = setup()
        await act(() => result.current.confirmSameChainSwap())
        expect(dependencies.fetchQuote).not.toHaveBeenCalled()
        expect(dependencies.sendTransaction).toHaveBeenCalledTimes(1)
    })

    it('blocks submission after failed simulation and clears pending state', async () => {
        const publicClient = {
            estimateGas: vi.fn().mockRejectedValue(new Error('estimate failed')),
            call: vi.fn().mockRejectedValue(new Error('call failed')),
        }
        const { result, dependencies } = setup({
            publicClient,
            simulateTransaction: undefined,
        })
        await expect(result.current.confirmSameChainSwap()).resolves.toBeNull()
        expect(dependencies.sendTransaction).not.toHaveBeenCalled()
        expect(dependencies.setReviewError).toHaveBeenCalledWith('This transaction is expected to fail.')
        await waitFor(() => expect(result.current.isConfirming).toBe(false))
    })

    it('recovers once from AllowanceExpired using refreshed approval and transaction', async () => {
        simulation.mockImplementationOnce(async () => {
            throw simulationFailure('AllowanceExpired')
        }).mockResolvedValueOnce(undefined)
        const { result, dependencies } = setup()
        await act(() => result.current.confirmSameChainSwap())
        expect(dependencies.invalidatePermit2Readiness).toHaveBeenCalledTimes(1)
        expect(dependencies.prepareSwapApproval).toHaveBeenCalledTimes(2)
        expect(dependencies.prepareSwapApproval.mock.calls[1][0]).toEqual(quote('0xabcd'))
        expect(simulation.mock.calls[1][0].transaction.data).toBe('0xabcd')
        expect(dependencies.sendTransaction).toHaveBeenCalledTimes(1)
    })

    it('does not retry a second AllowanceExpired and keeps wallet rejection visible', async () => {
        simulation.mockImplementation(async () => {
            throw simulationFailure('AllowanceExpired')
        })
        const failed = setup()
        await act(() => failed.result.current.confirmSameChainSwap())
        expect(failed.dependencies.fetchQuote).toHaveBeenCalledTimes(1)
        expect(failed.dependencies.prepareSwapApproval).toHaveBeenCalledTimes(2)
        expect(failed.dependencies.sendTransaction).not.toHaveBeenCalled()

        simulation.mockResolvedValue(undefined)
        const rejected = setup({ sendTransaction: vi.fn().mockRejectedValue({ code: 4001 }) })
        await act(() => rejected.result.current.confirmSameChainSwap())
        expect(rejected.dependencies.setReviewError).toHaveBeenCalledWith('Transaction rejected.')
        expect(rejected.result.current.isConfirming).toBe(false)
    })
})
