import { useEffect, useRef } from 'react'
import { highestValueWalletChain, nativeSwapInput } from '../services/walletValueDefault.js'

/** Apply the balance-based default once per wallet, without replacing an edited swap. */
export function useWalletValueDefault({ address, tokens, loading, stale, hasUserIntent, resetForWallet }) {
    const scope = useRef({ address: null, applied: false })
    useEffect(() => {
        const wallet = address?.toLowerCase() ?? null
        const changed = wallet !== scope.current.address
        if (changed) {
            scope.current = { address: wallet, applied: false }
            resetForWallet(nativeSwapInput())
        }
        if (!wallet || scope.current.applied) return
        if (!changed && hasUserIntent) {
            scope.current.applied = true
            return
        }
        if (loading || stale || !tokens?.length) return
        const chainId = highestValueWalletChain(tokens, null)
        if (chainId === null) return
        scope.current.applied = true
        resetForWallet(nativeSwapInput(chainId))
    }, [address, tokens, loading, stale, hasUserIntent, resetForWallet])
}
