import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, useWalletClient } from 'wagmi'

import {
    authenticateSponsorshipWallet,
    createSponsorshipOrder,
    fetchSponsorshipConfig,
    fetchSponsorshipOrder,
    prepareSponsorshipApproval,
    prepareSponsorshipContinuation,
    prepareSponsorshipPayment,
    signAndSubmitPrepaidZeroX,
    submitSponsorshipIntent,
} from '../services/prepaidSponsorship.js'
import {
    detectRawTransactionSigning,
    signPreparedSponsoredTransaction,
} from '../services/rawTransactionSigning.js'
import { isUserRejectedError } from '../services/swapTransaction.js'
import { useMetaMaskMultichainSigner } from './useMetaMaskMultichainSigner.js'

const initial = {
    open: false,
    phase: 'idle',
    config: null,
    order: null,
    intentExpiresAt: null,
    continuation: null,
    error: null,
}

export function usePrepaidSponsorship({
    quoteEndpoint,
    walletAddress,
    sellToken,
    buyToken,
    grossInputAmount,
    slippageBps,
    required,
    onConfirmed,
}) {
    const connection = useConnection()
    const { data: walletClient } = useWalletClient({ chainId: 56 })
    const [config, setConfig] = useState(null)
    const [state, setState] = useState(initial)
    const sessionTokenRef = useRef(null)
    const submittedIntentIdsRef = useRef(new Set())
    const walletEpochRef = useRef(0)
    const localCapability = useMemo(
        () => detectRawTransactionSigning({ connector: connection.connector, walletClient }),
        [connection.connector, walletClient],
    )
    const metaMaskSigner = useMetaMaskMultichainSigner({
        appKitAddress: walletAddress,
        authenticatedWalletAddress: walletAddress,
        connector: connection.connector,
        appKitConnected: Boolean(connection.connector && walletAddress),
    })
    const capability = localCapability.rawTransactionSigningSupported
        ? localCapability
        : metaMaskSigner.capability

    useEffect(() => {
        walletEpochRef.current += 1
        sessionTokenRef.current = null
        submittedIntentIdsRef.current.clear()
        setState(initial)
    }, [walletAddress])

    useEffect(() => {
        if (!quoteEndpoint || !walletAddress) {
            setConfig(null)
            return undefined
        }
        const controller = new AbortController()
        fetchSponsorshipConfig(quoteEndpoint, controller.signal)
            .then(setConfig)
            .catch(() => setConfig(null))
        return () => controller.abort()
    }, [quoteEndpoint, walletAddress])

    const start = useCallback(async () => {
        setState({ ...initial, open: true, phase: 'authenticating', config })
        if (!capability.rawTransactionSigningSupported) {
            if (metaMaskSigner.isMetaMask && metaMaskSigner.capability.status !== 'disabled') {
                setState({ ...initial, open: true, phase: 'signer-setup', config })
                return
            }
            setState({
                ...initial,
                open: true,
                phase: 'unsupported',
                config,
                error: {
                    code: 'WALLET_RAW_TRANSACTION_SIGNING_UNSUPPORTED',
                    message: 'This wallet cannot sign a private sponsored transaction without broadcasting it. Use a supported wallet or pay normal BNB gas.',
                },
            })
            return
        }
        if (!walletClient || !walletAddress || !sellToken || !buyToken || !grossInputAmount) return
        try {
            const session = await authenticateSponsorshipWallet({
                quoteEndpoint,
                walletAddress,
                walletClient,
            })
            sessionTokenRef.current = session.sessionToken
            const order = await createSponsorshipOrder(quoteEndpoint, session.sessionToken, {
                sellToken: sellToken.address,
                buyToken: buyToken.isNative ? 'native' : buyToken.address,
                grossInputAmount,
                slippageBps,
            }, crypto.randomUUID())
            setState({ ...initial, open: true, phase: 'review', config, order })
        } catch (error) {
            setState({
                ...initial,
                open: true,
                phase: isUserRejectedError(error) ? 'cancelled' : 'failed',
                config,
                error,
            })
        }
    }, [buyToken, capability.rawTransactionSigningSupported, config, grossInputAmount, metaMaskSigner.capability.status, metaMaskSigner.isMetaMask, quoteEndpoint, sellToken, slippageBps, walletAddress, walletClient])

    const signIntent = useCallback(async (action) => {
        const order = state.order
        const sessionToken = sessionTokenRef.current
        const walletEpoch = walletEpochRef.current
        if (!order || !sessionToken || !walletClient) return
        try {
            setState((current) => ({ ...current, phase: `${action}-preparing`, error: null }))
            const intent = action === 'payment'
                ? await prepareSponsorshipPayment(quoteEndpoint, sessionToken, order.id)
                : await prepareSponsorshipApproval(quoteEndpoint, sessionToken, order.id)
            setState((current) => ({ ...current, phase: `${action}-signing`, intentExpiresAt: intent.expiresAt }))
            await signPreparedSponsoredTransaction({
                transport: capability.transport,
                capability,
                walletClient,
                preparedTransaction: intent.transaction,
                authenticatedWalletAddress: walletAddress,
                multichainAccount: capability.account,
                isMetaMask: metaMaskSigner.isMetaMask,
                submitSignedTransaction: async (signedRawTransaction) => {
                    if (walletEpochRef.current !== walletEpoch) {
                        const error = new Error('The connected wallet changed during signing.')
                        error.code = 'METAMASK_MULTICHAIN_ACCOUNT_MISMATCH'
                        throw error
                    }
                    if (Date.parse(intent.expiresAt) <= Date.now()) {
                        const error = new Error('The sponsored intent expired. Request a fresh intent.')
                        error.code = 'INTENT_EXPIRED'
                        throw error
                    }
                    if (submittedIntentIdsRef.current.has(intent.intentId)) {
                        const error = new Error('This sponsored intent was already submitted in this browser interaction.')
                        error.code = 'INTENT_ALREADY_USED'
                        throw error
                    }
                    submittedIntentIdsRef.current.add(intent.intentId)
                    return submitSponsorshipIntent(
                        quoteEndpoint,
                        sessionToken,
                        intent.intentId,
                        signedRawTransaction,
                    )
                },
            })
            setState((current) => ({ ...current, phase: `${action}-submitted`, intentExpiresAt: null }))
        } catch (error) {
            setState((current) => ({
                ...current,
                phase: isUserRejectedError(error) ? 'cancelled' : 'failed',
                intentExpiresAt: null,
                error,
            }))
        }
    }, [capability, metaMaskSigner.isMetaMask, quoteEndpoint, state.order, walletAddress, walletClient])

    const requestContinuation = useCallback(async () => {
        const sessionToken = sessionTokenRef.current
        if (!state.order || !sessionToken) return
        try {
            setState((current) => ({ ...current, phase: 'continuation-loading', error: null }))
            const continuation = await prepareSponsorshipContinuation(
                quoteEndpoint,
                sessionToken,
                state.order.id,
            )
            setState((current) => ({ ...current, phase: 'continuation-ready', continuation }))
        } catch (error) {
            setState((current) => ({ ...current, phase: 'failed', error }))
        }
    }, [quoteEndpoint, state.order])

    const signContinuation = useCallback(async () => {
        if (!state.continuation || !walletClient || !walletAddress) return
        try {
            setState((current) => ({ ...current, phase: 'zero-x-signing', error: null }))
            await signAndSubmitPrepaidZeroX({
                quoteEndpoint,
                walletAddress,
                walletClient,
                quote: state.continuation,
            })
            setState((current) => ({ ...current, phase: 'zero-x-submitted' }))
        } catch (error) {
            setState((current) => ({
                ...current,
                phase: isUserRejectedError(error) ? 'cancelled' : 'failed',
                error,
            }))
        }
    }, [quoteEndpoint, state.continuation, walletAddress, walletClient])

    useEffect(() => {
        const sessionToken = sessionTokenRef.current
        if (!state.open || !state.order?.id || !sessionToken ||
            ['completed', 'expired', 'rejected', 'failed'].includes(state.order.status)) return undefined
        const controller = new AbortController()
        const timer = window.setTimeout(async () => {
            try {
                const order = await fetchSponsorshipOrder(
                    quoteEndpoint,
                    sessionToken,
                    state.order.id,
                    controller.signal,
                )
                setState((current) => ({
                    ...current,
                    order: { ...current.order, ...order },
                    phase: order.status === 'completed' ? 'completed' : current.phase,
                }))
                if (order.status === 'completed') await onConfirmed?.()
            } catch (error) {
                if (!controller.signal.aborted) setState((current) => ({ ...current, error }))
            }
        }, 3_000)
        return () => {
            controller.abort()
            window.clearTimeout(timer)
        }
    }, [onConfirmed, quoteEndpoint, state.open, state.order])

    const close = useCallback(() => {
        if (state.phase.endsWith('-signing') || state.phase.endsWith('-preparing')) return
        setState(initial)
    }, [state.phase])

    return {
        ...state,
        config,
        capability,
        metaMaskSigner,
        walletAddress,
        rawSigningTransport: capability.transport,
        retryStart: start,
        available: Boolean(required && config?.enabled),
        start,
        close,
        signPayment: () => signIntent('payment'),
        signApproval: () => signIntent('approval'),
        requestContinuation,
        signContinuation,
    }
}
