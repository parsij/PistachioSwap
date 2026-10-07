// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import PendingWalletOperation from './PendingWalletOperation.jsx'
import { beginOptimisticWalletTransaction, getWalletOperationDisplayState } from '../../services/optimisticBalances.js'

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
