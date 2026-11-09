import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    beginOptimisticWalletTransaction,
    confirmOptimisticWalletTransaction,
    finishOptimisticWalletTransaction,
    getOptimisticWalletDeltas,
    getWalletOperationDisplayState,
    walletTransactionReceiptStatus,
} from './optimisticBalances.js'

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('optimistic wallet operation display state', () => {
    it('keeps confirmation visible when receipt reconciliation finishes in the same tick', () => {
        vi.useFakeTimers()
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
        expect(getWalletOperationDisplayState(walletAddress)?.status).toBe('confirmed')
        vi.advanceTimersByTime(4_999)
        expect(getWalletOperationDisplayState(walletAddress)?.status).toBe('confirmed')
        vi.advanceTimersByTime(1)
        expect(getWalletOperationDisplayState(walletAddress)).toBeNull()
    })
})

it('does not restart the confirmation window on delayed final settlement', () => {
    vi.useFakeTimers()
    const walletAddress = '0x4444444444444444444444444444444444444444'
    const transactionHash = `0x${'ce'.repeat(32)}`
    beginOptimisticWalletTransaction({ walletAddress, transactionHash, operation: 'swapping',
        changes: [{ chainId: 137, tokenAddress: '0x5555555555555555555555555555555555555555', deltaRaw: -10n }] })
    confirmOptimisticWalletTransaction(transactionHash)
    vi.advanceTimersByTime(4_000)
    finishOptimisticWalletTransaction(transactionHash)
    expect(getWalletOperationDisplayState(walletAddress)?.status).toBe('confirmed')
    vi.advanceTimersByTime(1_000)
    expect(getWalletOperationDisplayState(walletAddress)).toBeNull()
    expect(finishOptimisticWalletTransaction(transactionHash)).toBe(false)
})

it('does not restart a previously submitted transaction when its hash callback is replayed', () => {
    vi.useFakeTimers()
    const walletAddress = '0x7777777777777777777777777777777777777777'
    const hash = `0x${'f'.repeat(64)}`
    const first = {
        walletAddress, transactionHash: hash, operation: 'swapping',
        settlementMode: 'external', referenceId: 'original-route',
        changes: [{
            chainId: 137,
            tokenAddress: '0x8888888888888888888888888888888888888888',
            deltaRaw: -1_400_000n,
        }],
    }
    expect(beginOptimisticWalletTransaction(first)).toBe(true)
    const original = getWalletOperationDisplayState(walletAddress)
    vi.advanceTimersByTime(60_000)
    expect(beginOptimisticWalletTransaction({
        ...first,
        referenceId: 'different-new-quote',
        changes: [{ chainId: 137, tokenAddress: first.changes[0].tokenAddress,
            deltaRaw: -1_200_000n }],
    })).toBe(false)
    expect(getWalletOperationDisplayState(walletAddress)).toMatchObject({
        transactionHash: hash,
        createdAt: original.createdAt,
        referenceId: 'original-route',
        changes: [expect.objectContaining({ deltaRaw: '-1400000' })],
    })
    finishOptimisticWalletTransaction(hash)
})

it('falls back to the curated chain RPC when configured receipt RPC has CORS or network errors', async () => {
    const hash = `0x${'aa'.repeat(32)}`
    const brokenUrl = 'https://unavailable-rpc.example'
    vi.stubEnv('VITE_EVM_8453_PUBLIC_RPC_URL', brokenUrl)
    const fetch = vi.fn(async (url) => {
        if (url === brokenUrl) throw new TypeError('Failed to fetch')
        return new Response(JSON.stringify({
            jsonrpc: '2.0', id: 1, result: { transactionHash: hash, status: '0x1' },
        }))
    })
    vi.stubGlobal('fetch', fetch)

    expect(await walletTransactionReceiptStatus(hash, 8453)).toBe('confirmed')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[0][0]).toBe(brokenUrl)
    expect(fetch.mock.calls[1][0]).not.toBe(brokenUrl)
})

it('does not report confirmation from a receipt for a different transaction', async () => {
    const hash = `0x${'bb'.repeat(32)}`
    const otherHash = `0x${'cc'.repeat(32)}`
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        jsonrpc: '2.0', id: 1, result: { transactionHash: otherHash, status: '0x1' },
    }))))

    expect(await walletTransactionReceiptStatus(hash, 8453)).toBe('pending')
})
