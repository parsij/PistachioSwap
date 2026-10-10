// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { beginOptimisticWalletTransaction, confirmOptimisticWalletTransaction, finishOptimisticWalletTransaction, rollbackOptimisticWalletTransaction } from '../../wallet/services/optimisticBalances.js'
import { recordWalletActivity } from '../../wallet/services/walletActivity.js'
import { preferredSwapChain, SWAP_CHAIN_USAGE_PREFIX } from './swapChainUsage.js'
const wallet = '0x1111111111111111111111111111111111111111'
const hashes = [1, 2, 3].map(n => '0x' + String(n).repeat(64))
const changes = [{ chainId: 8453, tokenAddress: '0x0000000000000000000000000000000000000000', deltaRaw: -1n }]
beforeEach(() => localStorage.clear())
afterEach(() => hashes.forEach(rollbackOptimisticWalletTransaction))
it('counts confirmed swap source receipts once, without counting pending sends or failures', () => {
    beginOptimisticWalletTransaction({ walletAddress: wallet, transactionHash: hashes[0], operation: 'swapping', changes })
    expect(preferredSwapChain(wallet)).toBe(1)
    confirmOptimisticWalletTransaction(hashes[0], { sourceOnly: true })
    confirmOptimisticWalletTransaction(hashes[0])
    finishOptimisticWalletTransaction(hashes[0])
    expect(preferredSwapChain(wallet)).toBe(8453)
    expect(JSON.parse(localStorage.getItem(SWAP_CHAIN_USAGE_PREFIX + wallet)).counts).toEqual({ 8453: 1 })
    beginOptimisticWalletTransaction({ walletAddress: wallet, transactionHash: hashes[1], operation: 'sending', changes })
    confirmOptimisticWalletTransaction(hashes[1])
    finishOptimisticWalletTransaction(hashes[1])
    beginOptimisticWalletTransaction({ walletAddress: wallet, transactionHash: hashes[2], operation: 'swapping', changes })
    rollbackOptimisticWalletTransaction(hashes[2])
    expect(JSON.parse(localStorage.getItem(SWAP_CHAIN_USAGE_PREFIX + wallet)).counts).toEqual({ 8453: 1 })
})
it('counts local confirmed Gas Assist swaps but never imported remote history, pending swaps or failures', () => {
    const activity = { walletAddress: wallet, chainId: 56, type: 'swapped', hash: hashes[0] }
    recordWalletActivity({ ...activity, source: 'remote', status: 'confirmed' })
    recordWalletActivity({ ...activity, status: 'pending' })
    recordWalletActivity({ ...activity, status: 'failed' })
    expect(preferredSwapChain(wallet)).toBe(1)
    recordWalletActivity({ ...activity, status: 'confirmed', provider: 'Gas Assist' })
    recordWalletActivity({ ...activity, status: 'confirmed', provider: 'Gas Assist' })
    expect(JSON.parse(localStorage.getItem(SWAP_CHAIN_USAGE_PREFIX + wallet)).counts).toEqual({ 56: 1 })
})
