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
    submitSponsorshipIntent,
} from '../services/prepaidSponsorship.js'
import {
    detectRawTransactionSigning,
    signPreparedSponsoredTransaction,
} from '../services/rawTransactionSigning.js'
import { isUserRejectedError } from '../../../services/swapTransaction.js'

const initial = {
    open: false,
    phase: 'idle',
    config: null,
    order: null,
    intentExpiresAt: null,
    continuation: null,
    error: null,
}

function phaseForOrderStatus(status, currentPhase) {
    return {
        'payment-submitting': 'payment-confirming',
        'payment-submitted': 'payment-confirming',
        'payment-confirmed': 'payment-confirmed',
        'approval-submitted': 'approval-confirming',
        'approval-confirmed': 'approval-confirmed',
        'swap-submitted': 'swap-confirming',
        completed: 'completed',
    }[status] ?? currentPhase
}

/**
 * Owns prepaid Gas Assist sponsorship order, authentication, preparation, signing, and continuation state.
 * @param {object} config Endpoint, wallet, token/amount/slippage intent, eligibility, and confirmed callback.
 * @returns {object} Sponsorship state and start/confirm/cancel/retry operations.
 * @sideEffects Calls sponsorship HTTP endpoints and may request wallet authentication/signing after explicit user actions.
 * @security Order/session/intent expiry and authenticated account must remain bound to the reviewed request.
 */
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
    const [configStatus, setConfigStatus] = useState('idle')
    const [configError, setConfigError] = useState(null)
    const [state, setState] = useState(initial)
    const sessionTokenRef = useRef(null)
    const submittedIntentIdsRef = useRef(new Set())
    const walletEpochRef = useRef(0)
    const localCapability = useMemo(
        () => detectRawTransactionSigning({ connector: connection.connector, walletClient }),
        [connection.connector, walletClient],
    )
    const capability = localCapability

    useEffect(() => {
        walletEpochRef.current += 1
        sessionTokenRef.current = null
        submittedIntentIdsRef.current.clear()
        setState(initial)
    }, [walletAddress])

    useEffect(() => {
        if (!quoteEndpoint || !walletAddress) {
            setConfig(null)
            setConfigStatus('idle')
            setConfigError(null)
            return undefined
        }
        const controller = new AbortController()
        setConfigStatus('loading')
        setConfigError(null)
        const walletEpoch = walletEpochRef.current
        fetchSponsorshipConfig(quoteEndpoint, controller.signal)
            .then((nextConfig) => {
                if (!controller.signal.aborted && walletEpochRef.current === walletEpoch) {
                    setConfig(nextConfig)
                    setConfigStatus('success')
                    setConfigError(null)
                }
            })
            .catch((error) => {
                if (!controller.signal.aborted && walletEpochRef.current === walletEpoch) {
                    setConfig(null)
                    setConfigStatus('error')
                    setConfigError(error)
                }
            })
        return () => controller.abort()
    }, [quoteEndpoint, walletAddress])

    const start = useCallback(async () => {
        const walletEpoch = walletEpochRef.current
        setState({ ...initial, open: true, phase: 'authenticating', config })
        if (
            connection.connector?.id !== 'pistachio-local' ||
            !capability.rawTransactionSigningSupported
        ) {
            setState({
                ...initial,
                open: true,
                phase: 'unsupported',
                config,
                error: {
                    code: 'PISTACHIO_WALLET_REQUIRED',
                    message: 'Gas Assist requires Pistachio Wallet.',
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
            if (walletEpochRef.current !== walletEpoch) return
            sessionTokenRef.current = session.sessionToken
            const order = await createSponsorshipOrder(quoteEndpoint, session.sessionToken, {
                sellToken: sellToken.address,
                buyToken: buyToken.isNative ? 'native' : buyToken.address,
                grossInputAmount,
                slippageBps,
            }, crypto.randomUUID())
            if (walletEpochRef.current !== walletEpoch) return
            setState({ ...initial, open: true, phase: 'review', config, order })
        } catch (error) {
            if (walletEpochRef.current !== walletEpoch) return
            setState({
                ...initial,
                open: true,
                phase: isUserRejectedError(error) ? 'cancelled' : 'failed',
                config,
                error,
            })
        }
    }, [buyToken, capability.rawTransactionSigningSupported, config, connection.connector?.id, grossInputAmount, quoteEndpoint, sellToken, slippageBps, walletAddress, walletClient])

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
                multichainAccount: walletAddress,
                submitSignedTransaction: async (signedRawTransaction) => {
                    if (walletEpochRef.current !== walletEpoch) {
                        const error = new Error('The connected wallet changed during signing.')
                        error.code = 'PISTACHIO_ACCOUNT_MISMATCH'
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
            setState((current) => ({ ...current, phase: `${action}-confirming`, intentExpiresAt: null }))
        } catch (error) {
            setState((current) => ({
                ...current,
                phase: isUserRejectedError(error) ? 'cancelled' : 'failed',
                intentExpiresAt: null,
                error,
            }))
        }
    }, [capability, quoteEndpoint, state.order, walletAddress, walletClient])

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
        const intent = state.continuation
        const sessionToken = sessionTokenRef.current
        const walletEpoch = walletEpochRef.current
        if (!intent || !sessionToken || !walletClient || !walletAddress) return
        try {
            setState((current) => ({ ...current, phase: 'swap-signing', error: null, intentExpiresAt: intent.expiresAt }))
            await signPreparedSponsoredTransaction({
                transport: capability.transport,
                capability,
                walletClient,
                preparedTransaction: intent.transaction,
                authenticatedWalletAddress: walletAddress,
                multichainAccount: walletAddress,
                submitSignedTransaction: async (signedRawTransaction) => {
                    if (walletEpochRef.current !== walletEpoch) {
                        const error = new Error('The connected wallet changed during signing.')
                        error.code = 'PISTACHIO_ACCOUNT_MISMATCH'
                        throw error
                    }
                    if (Date.parse(intent.expiresAt) <= Date.now()) {
                        const error = new Error('The sponsored swap intent expired. Request a fresh intent.')
                        error.code = 'INTENT_EXPIRED'
                        throw error
                    }
                    if (submittedIntentIdsRef.current.has(intent.intentId)) {
                        const error = new Error('This sponsored swap intent was already submitted.')
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
            setState((current) => ({ ...current, phase: 'swap-confirming', intentExpiresAt: null }))
        } catch (error) {
            setState((current) => ({
                ...current,
                phase: isUserRejectedError(error) ? 'cancelled' : 'failed',
                intentExpiresAt: null,
                error,
            }))
        }
    }, [capability, quoteEndpoint, state.continuation, walletAddress, walletClient])

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
                    phase: phaseForOrderStatus(order.status, current.phase),
                    pollRevision: (current.pollRevision ?? 0) + 1,
                }))
                if (order.status === 'completed') await onConfirmed?.()
            } catch (error) {
                if (!controller.signal.aborted) setState((current) => ({
                    ...current,
                    error,
                    pollRevision: (current.pollRevision ?? 0) + 1,
                }))
            }
        }, 3_000)
        return () => {
            controller.abort()
            window.clearTimeout(timer)
        }
    }, [onConfirmed, quoteEndpoint, state.open, state.order, state.pollRevision])

    const close = useCallback(() => {
        if (state.phase.endsWith('-signing') || state.phase.endsWith('-preparing')) return
        setState(initial)
    }, [state.phase])

    return {
        ...state,
        config,
        configStatus,
        configError,
        capability,
        metaMaskSigner: null,
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
