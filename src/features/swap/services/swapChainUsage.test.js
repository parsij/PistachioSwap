import { describe, expect, it, vi } from 'vitest'
import { preferredSwapChain, preferredSwapInput, recordSuccessfulSwap, SWAP_CHAIN_USAGE_PREFIX } from './swapChainUsage.js'
const wallet = '0x1111111111111111111111111111111111111111'
const other = '0x2222222222222222222222222222222222222222'
function storage() {
    const data = new Map()
    return { getItem: vi.fn((key) => data.get(key) ?? null), setItem: vi.fn((key, value) => data.set(key, value)) }
}
const swap = (chainId, n, address = wallet) => ({ walletAddress: address, chainId, hash: '0x' + n.toString(16).padStart(64, '0') })
describe('local wallet swap chain counters', () => {
    it('starts Ethereum and chooses the most used source chain, independently per wallet', () => {
        const store = storage()
        expect(preferredSwapChain(wallet, store)).toBe(1)
        recordSuccessfulSwap(swap(8453, 1), store)
        recordSuccessfulSwap(swap(56, 2), store)
        recordSuccessfulSwap(swap(8453, 3), store)
        expect(preferredSwapChain(wallet, store)).toBe(8453)
        expect(preferredSwapChain(other, store)).toBe(1)
        expect(preferredSwapInput(wallet, store)).toMatchObject({ chainId: 8453, symbol: 'ETH', isNative: true })
        expect(store.getItem.mock.calls.every(([key]) => key.startsWith(SWAP_CHAIN_USAGE_PREFIX))).toBe(true)
    })
    it('deduplicates confirmation callbacks and reloads, including address/hash casing', () => {
        const store = storage()
        expect(recordSuccessfulSwap(swap(10, 10), store)).toBe(true)
        expect(recordSuccessfulSwap({ ...swap(10, 10), walletAddress: wallet.toUpperCase().replace('0X', '0x'), hash: swap(10, 10).hash.toUpperCase().replace('0X', '0x') }, store)).toBe(false)
        expect(JSON.parse(store.getItem(SWAP_CHAIN_USAGE_PREFIX + wallet)).counts).toEqual({ 10: 1 })
    })
    it('uses a deterministic tie and ignores unsupported/corrupt preferences', () => {
        const store = storage()
        recordSuccessfulSwap(swap(56, 1), store)
        recordSuccessfulSwap(swap(1, 2), store)
        expect(preferredSwapChain(wallet, store)).toBe(1)
        store.setItem(SWAP_CHAIN_USAGE_PREFIX + wallet, JSON.stringify({ counts: { 999999: 800, 10: -1, 56: '5', 8453: 2 } }))
        expect(preferredSwapChain(wallet, store)).toBe(8453)
        store.setItem(SWAP_CHAIN_USAGE_PREFIX + wallet, '{broken')
        expect(preferredSwapChain(wallet, store)).toBe(1)
        expect(recordSuccessfulSwap(swap(10, 3), store)).toBe(true)
    })
    it('fails safely with unavailable storage and invalid inputs', () => {
        const blocked = { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') } }
        expect(preferredSwapChain(wallet, blocked)).toBe(1)
        expect(recordSuccessfulSwap(swap(10, 1), blocked)).toBe(false)
        expect(recordSuccessfulSwap(swap(999999, 1), storage())).toBe(false)
        expect(recordSuccessfulSwap({ ...swap(10, 1), hash: 'bad' }, storage())).toBe(false)
    })
})
