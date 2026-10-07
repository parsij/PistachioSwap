// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import PendingWalletOperation from './PendingWalletOperation.jsx'
import { beginOptimisticWalletTransaction, confirmOptimisticWalletTransaction, getWalletOperationDisplayState } from '../../services/optimisticBalances.js'

vi.mock('../../services/reconcilePendingWalletOperations.js', () => ({
    reconcilePendingWalletOperations: () => new Promise(() => {}),
}))

afterEach(() => { cleanup(); vi.useRealTimers() })

it('removes Swapping after 15 minutes even when settlement polling never resolves', async () => {
    vi.useFakeTimers()
    const walletAddress = '0x8888888888888888888888888888888888888888'
    beginOptimisticWalletTransaction({ walletAddress, transactionHash: `0x${'ca'.repeat(32)}`,
        operation: 'swapping', settlementMode: 'external', referenceId: 'stalled-poll',
        changes: [{ chainId: 56, tokenAddress: '0x0000000000000000000000000000000000000000', deltaRaw: -1n }] })
    render(<PendingWalletOperation walletAddress={walletAddress} />)
    expect(screen.getByText('Swapping')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000) })
    expect(getWalletOperationDisplayState(walletAddress)).toBeNull()
    expect(screen.queryByText('Swapped')).toBeNull()
})

it('shows Source confirmed and then hides it while destination tracking remains pending', async () => {
    vi.useFakeTimers()
    const walletAddress = '0x9999999999999999999999999999999999999999'
    const transactionHash = `0x${'cb'.repeat(32)}`
    beginOptimisticWalletTransaction({ walletAddress, transactionHash, operation: 'swapping',
        settlementMode: 'external', referenceId: 'source-proof',
        changes: [{ chainId: 56, tokenAddress: '0x0000000000000000000000000000000000000000', deltaRaw: -1n }] })
    render(<PendingWalletOperation walletAddress={walletAddress} />)
    act(() => { confirmOptimisticWalletTransaction(transactionHash, { sourceOnly: true }) })
    expect(screen.getByTitle('Source transaction confirmed; destination settlement is still being tracked')).toBeTruthy()
    expect(screen.queryByText('Swapped')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(getWalletOperationDisplayState(walletAddress)).toBeNull()
})
