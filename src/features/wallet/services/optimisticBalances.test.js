import { describe, expect, it } from 'vitest'

import {
    beginOptimisticWalletTransaction,
    confirmOptimisticWalletTransaction,
    finishOptimisticWalletTransaction,
    getOptimisticWalletDeltas,
    getWalletOperationDisplayState,
} from './optimisticBalances.js'

describe('optimistic wallet operation display state', () => {
    it('shows a confirmed swap immediately while retaining optimistic deltas until final settlement', () => {
        const walletAddress = '0x1111111111111111111111111111111111111111'
        const transactionHash = `0x${'ab'.repeat(32)}`
        const sellToken = {
            chainId: 56,
            address: '0x2222222222222222222222222222222222222222',
            symbol: 'SELL',
            name: 'Sell',
            decimals: 18,
        }
        const buyToken = {
            chainId: 56,
            address: '0x3333333333333333333333333333333333333333',
            symbol: 'BUY',
            name: 'Buy',
            decimals: 18,
        }

        expect(beginOptimisticWalletTransaction({
            walletAddress,
            transactionHash,
            operation: 'swapping',
            changes: [
                { chainId: 56, token: sellToken, deltaRaw: -10n },
                { chainId: 56, token: buyToken, deltaRaw: 20n },
            ],
        })).toBe(true)

        expect(getWalletOperationDisplayState(walletAddress)?.status).toBe('pending')
        expect(getOptimisticWalletDeltas(walletAddress)).toHaveLength(2)

        expect(confirmOptimisticWalletTransaction(transactionHash)).toBe(true)
        expect(getWalletOperationDisplayState(walletAddress)).toMatchObject({
            transactionHash,
            operation: 'swapping',
            status: 'confirmed',
        })

        // Confirmation changes presentation state only. Keep the deltas until
        // the wallet refresh window has finished so balances do not flicker.
        expect(getOptimisticWalletDeltas(walletAddress)).toHaveLength(2)

        expect(finishOptimisticWalletTransaction(transactionHash)).toBe(true)
        expect(getOptimisticWalletDeltas(walletAddress)).toHaveLength(0)
        expect(getWalletOperationDisplayState(walletAddress)).toBeNull()
    })
})
