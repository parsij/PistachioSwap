// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const receiptState = vi.hoisted(() => ({ isSuccess: false, isError: false }))
const optimistic = vi.hoisted(() => ({
    begin: vi.fn(),
    confirm: vi.fn(),
    finish: vi.fn(),
    rollback: vi.fn(),
}))

vi.mock('#wallet-runtime', () => ({
    useWaitForTransactionReceipt: () => receiptState,
}))

vi.mock('../../wallet/services/optimisticBalances.js', () => ({
    beginOptimisticWalletTransaction: optimistic.begin,
    confirmOptimisticWalletTransaction: optimistic.confirm,
    finishOptimisticWalletTransaction: optimistic.finish,
    rollbackOptimisticWalletTransaction: optimistic.rollback,
}))

import { useSameChainReceiptLifecycle } from './useSameChainReceiptLifecycle.js'

function createConfig(overrides = {}) {
    return {
        chainId: 56,
        account: '0x1111111111111111111111111111111111111111',
        walletChainId: 56,
        executionMode: 'normal',
        setVisibleStatus: vi.fn(),
        closeReview: vi.fn(),
        resetInputsAfterSuccess: vi.fn(),
        invalidateQuoteAfterSuccess: vi.fn(),
        refreshWalletBalances: vi.fn().mockResolvedValue(undefined),
        setReviewError: vi.fn(),
        setReviewOperation: vi.fn(),
        diagnostic: vi.fn(),
        ...overrides,
    }
}

describe('useSameChainReceiptLifecycle', () => {
    beforeEach(() => {
        receiptState.isSuccess = false
        receiptState.isError = false
        optimistic.begin.mockReset()
        optimistic.confirm.mockReset()
        optimistic.finish.mockReset()
        optimistic.rollback.mockReset()
    })

    it('applies successful receipt side effects once and owns the confirmed status', async () => {
        const config = createConfig()
        const { result, rerender } = renderHook(() => useSameChainReceiptLifecycle(config))
        act(() => {
            result.current.setTransactionHash('0xabc')
            result.current.setTransactionStatus('submitted')
        })
        receiptState.isSuccess = true
        rerender()
        await waitFor(() => expect(result.current.transactionStatus).toBe('confirmed'))
        expect(optimistic.confirm).toHaveBeenCalledWith('0xabc')
        expect(config.setVisibleStatus).toHaveBeenCalledWith('Swap confirmed. Updating wallet balances…')
        expect(config.closeReview).toHaveBeenCalledTimes(1)
        expect(config.resetInputsAfterSuccess).toHaveBeenCalledTimes(1)
        expect(config.invalidateQuoteAfterSuccess).toHaveBeenCalledTimes(1)
        expect(config.refreshWalletBalances).toHaveBeenCalledTimes(1)
        rerender()
        expect(config.refreshWalletBalances).toHaveBeenCalledTimes(1)
    })

    it('does not apply an old receipt to the new form after its transaction state is reset', () => {
        const config = createConfig()
        const { result, rerender } = renderHook(() => useSameChainReceiptLifecycle(config))
        act(() => {
            result.current.setTransactionHash('0xabc')
            result.current.setTransactionStatus('submitted')
        })
        act(() => result.current.resetReceiptLifecycle())
        receiptState.isSuccess = true
        rerender()
        expect(result.current.transactionHash).toBeNull()
        expect(result.current.transactionStatus).toBe('idle')
        expect(config.resetInputsAfterSuccess).not.toHaveBeenCalled()
        expect(config.invalidateQuoteAfterSuccess).not.toHaveBeenCalled()
        expect(optimistic.confirm).not.toHaveBeenCalled()
    })

    it('keeps receipt failure visible and resets pending state when wallet identity changes', async () => {
        const config = createConfig()
        const { result, rerender } = renderHook(
            ({ account }) => useSameChainReceiptLifecycle({ ...config, account }),
            { initialProps: { account: config.account } },
        )
        act(() => {
            result.current.setTransactionHash('0xdef')
            result.current.setTransactionStatus('submitted')
        })
        receiptState.isError = true
        rerender({ account: config.account })
        await waitFor(() => expect(result.current.transactionStatus).toBe('failed'))
        expect(config.setReviewError).toHaveBeenCalledWith('The transaction failed before confirmation.')
        expect(config.setReviewOperation).toHaveBeenCalledWith('idle')
        rerender({ account: '0x2222222222222222222222222222222222222222' })
        expect(result.current.transactionHash).toBeNull()
        expect(result.current.transactionStatus).toBe('idle')
    })
})
