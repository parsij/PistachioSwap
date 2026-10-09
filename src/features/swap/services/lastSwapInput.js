import { isAddress, zeroAddress } from 'viem'
import { getCuratedEvmChain } from '../../../web3/curatedEvmChains.js'

export const LAST_SWAP_INPUT_KEY = 'pistachio:last-swap-input:v1'

function selection(value) {
    const chain = getCuratedEvmChain(Number(value?.chainId))
    if (!chain || !isAddress(value?.address ?? '')) return null
    const address = value.address.toLowerCase()
    if (address === zeroAddress) return { chainId: chain.id, address, isNative: true,
        name: chain.nativeCurrency.name, symbol: chain.nativeCurrency.symbol, decimals: chain.nativeCurrency.decimals,
        uiSelectionOrigin: 'user' }
    if (!Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 255) return null
    return { chainId: chain.id, address, name: String(value.name ?? 'Token').slice(0, 80),
        symbol: String(value.symbol ?? 'TOKEN').slice(0, 24), decimals: value.decimals, uiSelectionOrigin: 'user' }
}

/** Remember public token selection only; prices, balances and amounts reload from live data. */
export function readLastSwapInput(storage) {
    try { storage ??= globalThis.localStorage; return selection(JSON.parse(storage?.getItem(LAST_SWAP_INPUT_KEY) ?? 'null')) } catch { return null }
}
export function rememberSwapInput(token, storage) {
    try {
        storage ??= globalThis.localStorage
        const value = selection(token)
        if (value) storage?.setItem(LAST_SWAP_INPUT_KEY, JSON.stringify(value))
    } catch { /* Storage can be disabled; swapping still works. */ }
}
