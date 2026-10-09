import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchNetworkFees, fetchPendingNonce, networkFeeCap, prepareNetworkFeeTransaction, resolveNetworkFeeSelection } from '../services/networkFees.js'

/** Wallet/source-chain-scoped choices; manual nonces are session-only. */
export function useNetworkFees({ publicClient, chainId, automatic = true, enabled = true, gasEstimate = null, account }) {
    const [state, setState] = useState({ snapshot: null, error: null, loading: false })
    const [choice, setChoice] = useState(null)
    useEffect(() => { setChoice(previous => previous?.chainId === Number(chainId) && previous.account === account ? previous : null) }, [chainId, account])
    const mountedRef = useRef(true)
    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
    const currentRef = useRef({ chainId, publicClient, automatic, choice, account })
    currentRef.current = { chainId, publicClient, automatic, choice, account }
    const [nonceState, setNonceState] = useState(null)
    const nonceVersion = useRef(0)
    const refreshNonce = useCallback(async () => {
        const version = ++nonceVersion.current
        const matches = () => mountedRef.current && version === nonceVersion.current &&
            currentRef.current.chainId === chainId && currentRef.current.account === account && currentRef.current.publicClient === publicClient
        setNonceState({ chainId, account, loading: true })
        try {
            const value = await fetchPendingNonce(publicClient, chainId, account)
            if (matches()) setNonceState({ chainId, account, value, loading: false })
        } catch {
            if (matches()) setNonceState({ chainId, account, loading: false, error: 'Pending nonce unavailable. Automatic still lets your wallet choose.' })
        }
    }, [account, chainId, publicClient])
    const clearNonce = useCallback(() => setChoice(previous => {
        if (previous?.fields?.nonce === undefined) return previous
        const { nonce: _nonce, ...fields } = previous.fields
        return { ...previous, fields }
    }), [])
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
    const selection = choice?.chainId === Number(chainId) && choice.account === account ? choice : { chainId: Number(chainId), mode: 'standard' }
    let fields = null
    let validationError = null
    if (snapshot) {
        try { fields = resolveNetworkFeeSelection(snapshot, selection, chainId) }
        catch (error) { validationError = error.message }
    }
    const select = (mode, customFields) => setChoice({ chainId: Number(chainId), account, mode, ...(customFields ? { fields: customFields } : {}) })
    const prepareTransaction = useCallback(async (transaction, requestedChainId = chainId, { applyNonce = true } = {}) => {
        const intent = currentRef.current
        if (intent.automatic) return transaction
        if (intent.account !== account || intent.publicClient !== publicClient || Number(intent.chainId) !== Number(chainId)) {
            throw new Error('Network fee selection changed. Review the swap again.')
        }
        if (Number(requestedChainId) !== Number(intent.chainId)) throw new Error('Selected network fees do not match this transaction.')
        const selected = intent.choice?.chainId === Number(chainId) && intent.choice.account === account ? intent.choice : { chainId: Number(chainId), mode: 'standard' }
        const fresh = await fetchNetworkFees(publicClient, chainId, Date.now, { ...transaction, account })
        if (currentRef.current.chainId !== intent.chainId || currentRef.current.automatic !== intent.automatic || currentRef.current.account !== intent.account || currentRef.current.publicClient !== intent.publicClient ||
            currentRef.current.choice !== intent.choice) throw new Error('Network fee selection changed. Review the swap again.')
        const prepared = await prepareNetworkFeeTransaction({ publicClient, transaction, account, snapshot: fresh, selection: selected, chainId, applyNonce })
        if (!mountedRef.current || currentRef.current.chainId !== intent.chainId || currentRef.current.automatic !== intent.automatic || currentRef.current.account !== intent.account || currentRef.current.publicClient !== intent.publicClient ||
            currentRef.current.choice !== intent.choice) throw new Error('Network fee selection changed. Review the swap again.')
        return prepared
    }, [account, chainId, publicClient])
    let gas = null
    try { if (gasEstimate != null && BigInt(gasEstimate) > 0n) gas = BigInt(gasEstimate) } catch { /* No quote gas estimate yet. */ }
    const maximumNativeFeeWei = fields && gas ? gas * networkFeeCap(fields) : null
    const nonceInfo = nonceState?.chainId === chainId && nonceState.account === account ? nonceState : null
    return { account, pendingNonce: nonceInfo?.value, nonceLoading: nonceInfo?.loading, nonceError: nonceInfo?.error,
        refreshNonce, clearNonce, snapshot, selection, fields, automatic, select, refresh, prepareTransaction,
        gasEstimate: gas, maximumNativeFeeWei, error: validationError ?? state.error,
        loading: state.loading, chainId: Number(chainId) }
}
