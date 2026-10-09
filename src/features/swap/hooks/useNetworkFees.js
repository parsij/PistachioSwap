import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchNetworkFees, networkFeeCap, prepareNetworkFeeTransaction, resolveNetworkFeeSelection } from '../services/networkFees.js'

/** Source-chain-scoped fee choices; custom values are session-only and never reused on another chain. */
export function useNetworkFees({ publicClient, chainId, automatic = true, enabled = true, gasEstimate = null, account }) {
    const [state, setState] = useState({ snapshot: null, error: null, loading: false })
    const [choice, setChoice] = useState(null)
    useEffect(() => { setChoice(previous => previous?.chainId === Number(chainId) ? previous : null) }, [chainId])
    const mountedRef = useRef(true)
    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
    const currentRef = useRef({ chainId, publicClient, automatic, choice, account })
    currentRef.current = { chainId, publicClient, automatic, choice, account }
    const refreshVersion = useRef(0)
    const refresh = useCallback(async () => {
        const version = ++refreshVersion.current
        setState(previous => ({ ...previous, loading: true, error: null }))
        try {
            const snapshot = await fetchNetworkFees(publicClient, chainId)
            if (version !== refreshVersion.current || !mountedRef.current || currentRef.current.chainId !== chainId || currentRef.current.publicClient !== publicClient) return null
            setState({ snapshot, loading: false, error: null })
            return snapshot
        } catch (error) {
            if (version === refreshVersion.current && mountedRef.current && currentRef.current.chainId === chainId && currentRef.current.publicClient === publicClient) {
                setState(previous => ({ ...previous, loading: false, error: error.message }))
            }
            return null
        }
    }, [chainId, publicClient])
    useEffect(() => {
        if (!enabled) return
        void refresh()
        const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void refresh() }, 15_000)
        return () => clearInterval(timer)
    }, [enabled, refresh])
    const snapshot = state.snapshot?.chainId === Number(chainId) ? state.snapshot : null
    const selection = choice?.chainId === Number(chainId) ? choice : { chainId: Number(chainId), mode: 'standard' }
    let fields = null
    let validationError = null
    if (snapshot) {
        try { fields = resolveNetworkFeeSelection(snapshot, selection, chainId) }
        catch (error) { validationError = error.message }
    }
    const select = (mode, customFields) => setChoice({ chainId: Number(chainId), mode, ...(customFields ? { fields: customFields } : {}) })
    const prepareTransaction = useCallback(async (transaction, requestedChainId = chainId) => {
        const intent = currentRef.current
        if (intent.automatic) return transaction
        if (Number(requestedChainId) !== Number(intent.chainId)) throw new Error('Selected network fees do not match this transaction.')
        const selected = intent.choice?.chainId === Number(chainId) ? intent.choice : { chainId: Number(chainId), mode: 'standard' }
        const fresh = await fetchNetworkFees(publicClient, chainId, Date.now, { ...transaction, account })
        if (currentRef.current.chainId !== intent.chainId || currentRef.current.automatic !== intent.automatic || currentRef.current.account !== intent.account ||
            currentRef.current.choice !== intent.choice) throw new Error('Network fee selection changed. Review the swap again.')
        const prepared = await prepareNetworkFeeTransaction({ publicClient, transaction, account, snapshot: fresh, selection: selected, chainId })
        if (!mountedRef.current || currentRef.current.chainId !== intent.chainId || currentRef.current.automatic !== intent.automatic || currentRef.current.account !== intent.account ||
            currentRef.current.choice !== intent.choice) throw new Error('Network fee selection changed. Review the swap again.')
        return prepared
    }, [account, chainId, publicClient])
    let gas = null
    try { if (gasEstimate != null && BigInt(gasEstimate) > 0n) gas = BigInt(gasEstimate) } catch { /* No quote gas estimate yet. */ }
    const maximumNativeFeeWei = fields && gas ? gas * networkFeeCap(fields) : null
    return { snapshot, selection, fields, automatic, select, refresh, prepareTransaction,
        gasEstimate: gas, maximumNativeFeeWei, error: validationError ?? state.error,
        loading: state.loading, chainId: Number(chainId) }
}
