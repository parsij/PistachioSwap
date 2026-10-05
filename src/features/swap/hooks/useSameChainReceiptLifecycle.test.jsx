// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const receiptState = vi.hoisted(() => ({ isSuccess: false, isError: false }))

vi.mock('#wallet-runtime', () => ({
    useWaitForTransactionReceipt: () => receiptState,
}))

import { useSameChainReceiptLifecycle } from './useSameChainReceiptLifecycle.js'
import {
    getOptimisticWalletTransactions,
    getWalletOperationDisplayState,
    rollbackOptimisticWalletTransaction,
} from '../../wallet/services/optimisticBalances.js'

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
        expect(config.setVisibleStatus).toHaveBeenCalledWith('Swap confirmed. Updating wallet balances…')
        expect(config.closeReview).toHaveBeenCalledTimes(1)
        expect(config.resetInputsAfterSuccess).toHaveBeenCalledTimes(1)
        expect(config.invalidateQuoteAfterSuccess).toHaveBeenCalledTimes(1)
        expect(config.refreshWalletBalances).toHaveBeenCalledTimes(1)
        rerender()
        expect(config.refreshWalletBalances).toHaveBeenCalledTimes(1)
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

    it('settles an external-wallet swap as soon as its receipt confirms, even if the screen unmounts', async () => {
        const hash = `0x${'ab'.repeat(32)}`
        const config = createConfig({
            sellToken: { chainId: 56, address: '0x0000000000000000000000000000000000000000', isNative: true, symbol: 'BNB', decimals: 18 },
            buyToken: { chainId: 56, address: '0x2222222222222222222222222222222222222222', symbol: 'TOKEN', decimals: 18 },
            quote: { selectedQuote: { sellAmount: '1000', buyAmount: '2000' } },
        })
        config.resetInputsAfterSuccess.mockImplementation(() => {
            // The form must never clear while the shared operation still says Swapping.
            expect(getWalletOperationDisplayState(config.account)?.status).toBe('confirmed')
        })
        const { result, rerender, unmount } = renderHook(() => useSameChainReceiptLifecycle(config))
        try {
            act(() => {
                result.current.setTransactionHash(hash)
                result.current.setTransactionStatus('submitted')
            })
            expect(getWalletOperationDisplayState(config.account)?.status).toBe('pending')
            receiptState.isSuccess = true
            rerender()
            expect(result.current.transactionStatus).toBe('confirmed')
            expect(getOptimisticWalletTransactions(config.account)).toEqual([])
            expect(getWalletOperationDisplayState(config.account)?.status).toBe('confirmed')
            unmount()
            expect(getOptimisticWalletTransactions(config.account)).toEqual([])
        } finally {
            unmount()
            rollbackOptimisticWalletTransaction(hash)
        }
    })
})
