import { describe, expect, it } from 'vitest'
import { LAST_SWAP_INPUT_KEY, readLastSwapInput, rememberSwapInput } from './lastSwapInput.js'

const usdc = { chainId: 8453, address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'USD Coin', symbol: 'USDC', decimals: 6 }
const storage = () => { const values = new Map(); return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } }
describe('Last swap input', () => {
    it('restores exact chain/address and excludes stale financial data and trust flags', () => {
        const store = storage()
        rememberSwapInput({ ...usdc, rawBalance: '999', priceUSD: '800', securityStatus: 'trusted', sellAmount: '5' }, store)
        expect(readLastSwapInput(store)).toEqual({ ...usdc, uiSelectionOrigin: 'user' })
        expect(store.getItem(LAST_SWAP_INPUT_KEY)).not.toMatch(/rawBalance|priceUSD|securityStatus|sellAmount/)
    })
    it('reconstructs the native token on the last chain instead of BNB', () => {
        const store = storage()
        rememberSwapInput({ chainId: 10, address: '0x0000000000000000000000000000000000000000', symbol: 'BNB' }, store)
        expect(readLastSwapInput(store)).toMatchObject({ chainId: 10, symbol: 'ETH', isNative: true, decimals: 18 })
    })
    it.each(['broken', JSON.stringify({ ...usdc, chainId: 999999 }), JSON.stringify({ ...usdc, address: 'USDC' }), JSON.stringify({ ...usdc, decimals: -1 })])('ignores invalid or unsupported saved selections', value => {
        const store = storage(); store.setItem(LAST_SWAP_INPUT_KEY, value)
        expect(readLastSwapInput(store)).toBeNull()
    })
    it('handles blocked storage without breaking the swap', () => {
        const store = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
        expect(readLastSwapInput(store)).toBeNull()
        expect(() => rememberSwapInput(usdc, store)).not.toThrow()
    })
})
