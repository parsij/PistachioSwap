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
    prepareSponsorshipPackage,
    submitSponsorshipIntent,
    submitSponsorshipPackage,
} from '../services/prepaidSponsorship.js'
import {
    detectRawTransactionSigning,
    signPreparedSponsoredTransaction,
    signPreparedSponsoredPackage,
} from '../services/rawTransactionSigning.js'
import {
    gasAssistTrace,
    gasAssistTraceError,
    gasAssistTraceStep,
} from '../services/gasAssistTrace.js'
import { isUserRejectedError } from '../../../services/swapTransaction.js'

const initial = {
    open: false,
    phase: 'idle',
    config: null,
    order: null,
    intentExpiresAt: null,
    continuation: null,
    error: null,
    lastPollError: null,
    pollRevision: 0,
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
        expired: 'expired',
        rejected: 'failed',
        failed: 'failed',
    }[status] ?? currentPhase
}

function flowError(code, message, details = {}) {
    const error = new Error(message)
    error.code = code
    error.details = details
    return error
}

function validRawAmount(value) {
    return /^[1-9]\d*$/.test(String(value ?? ''))
}

function createIdempotencyKey() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID()
    }
    return `gas-assist-${Date.now()}-${Math.random().toString(16).slice(2)}`
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
    const flowEpochRef = useRef(0)
    const operationRef = useRef(null)
    const confirmedOrderIdsRef = useRef(new Set())
    const localCapability = useMemo(
        () => detectRawTransactionSigning({ connector: connection.connector, walletClient }),
        [connection.connector, walletClient],
    )
    const capability = localCapability

    const isCurrent = useCallback((walletEpoch, flowEpoch) => (
        walletEpochRef.current === walletEpoch && flowEpochRef.current === flowEpoch
    ), [])

    const beginOperation = useCallback((name) => {
        if (operationRef.current) {
            gasAssistTrace('flow.operation.ignored', {
                requestedOperation: name,
                activeOperation: operationRef.current,
            })
            return false
        }
        operationRef.current = name
        gasAssistTrace('flow.operation.start', { operation: name })
        return true
    }, [])

    const finishOperation = useCallback((name) => {
        if (operationRef.current === name) operationRef.current = null
        gasAssistTrace('flow.operation.finish', { operation: name })
    }, [])

    const publishFailure = useCallback((error, {
        walletEpoch,
        flowEpoch,
        keepOrder = true,
    }) => {
        if (!isCurrent(walletEpoch, flowEpoch)) {
            gasAssistTrace('flow.error.ignored-stale', {
                code: error?.code,
                message: error?.message,
            })
            return
        }
        gasAssistTraceError('flow.failed', error, {
            walletAddress,
            orderId: state.order?.id,
        })
        setState((current) => ({
            ...initial,
            open: true,
            config,
            order: keepOrder ? current.order : null,
            phase: isUserRejectedError(error) ? 'cancelled' : 'failed',
            error,
        }))
    }, [config, isCurrent, state.order?.id, walletAddress])

    useEffect(() => {
        walletEpochRef.current += 1
        flowEpochRef.current += 1
        operationRef.current = null
        sessionTokenRef.current = null
        submittedIntentIdsRef.current.clear()
        confirmedOrderIdsRef.current.clear()
        setState(initial)
        gasAssistTrace('flow.wallet-context-reset', {
            walletAddress,
            connectorId: connection.connector?.id,
            quoteEndpoint,
        })
    }, [connection.connector?.id, quoteEndpoint, walletAddress])

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
        gasAssistTrace('config.load.start', { walletAddress })
        fetchSponsorshipConfig(quoteEndpoint, controller.signal)
            .then((nextConfig) => {
                if (!controller.signal.aborted && walletEpochRef.current === walletEpoch) {
                    setConfig(nextConfig)
                    setConfigStatus('success')
                    setConfigError(null)
                    gasAssistTrace('config.load.success', {
                        walletAddress,
                        enabled: nextConfig?.enabled,
                    })
                }
            })
            .catch((error) => {
                if (!controller.signal.aborted && walletEpochRef.current === walletEpoch) {
                    setConfig(null)
                    setConfigStatus('error')
                    setConfigError(error)
                    gasAssistTraceError('config.load.error', error, { walletAddress })
                }
            })
        return () => controller.abort()
    }, [quoteEndpoint, walletAddress])

    const start = useCallback(async () => {
        const operation = 'start'
        if (!beginOperation(operation)) return
        const walletEpoch = walletEpochRef.current
        const flowEpoch = ++flowEpochRef.current
        setState({ ...initial, open: true, phase: 'authenticating', config })

        try {
            if (
                connection.connector?.id !== 'pistachio-local' ||
                !capability.rawTransactionSigningSupported
            ) {
                const error = flowError(
                    'PISTACHIO_WALLET_REQUIRED',
                    'Gas Assist requires Pistachio Wallet.',
                    { stage: 'flow.start' },
                )
                if (isCurrent(walletEpoch, flowEpoch)) {
                    setState({
                        ...initial,
                        open: true,
                        phase: 'unsupported',
                        config,
                        error,
                    })
                }
                return
            }
            if (configStatus === 'loading') {
                throw flowError(
                    'SPONSORSHIP_CONFIG_LOADING',
                    'Gas Assist is still loading. Try again in a moment.',
                    { stage: 'flow.start' },
                )
            }
            if (configStatus === 'error') {
                throw configError ?? flowError(
                    'SPONSORSHIP_CONFIG_UNAVAILABLE',
                    'Gas Assist configuration could not be loaded.',
                    { stage: 'flow.start' },
                )
            }
            if (!config?.enabled) {
                throw flowError(
                    'SPONSORSHIP_DISABLED',
                    'Gas Assist is currently unavailable.',
                    { stage: 'flow.start' },
                )
            }
            if (!quoteEndpoint) {
                throw flowError('SPONSORSHIP_ENDPOINT_MISSING', 'Gas Assist is not configured.', { stage: 'flow.start' })
            }
            if (!walletClient || !walletAddress) {
                throw flowError('WALLET_NOT_CONNECTED', 'Connect Pistachio Wallet first.', { stage: 'flow.start' })
            }
            if (!sellToken?.address || !buyToken || (!buyToken.isNative && !buyToken.address)) {
                throw flowError('SWAP_TOKENS_MISSING', 'Choose both swap tokens first.', { stage: 'flow.start' })
            }
            if (!validRawAmount(grossInputAmount)) {
                throw flowError('SWAP_AMOUNT_INVALID', 'Enter a valid token amount.', { stage: 'flow.start' })
            }
            if (!Number.isInteger(Number(slippageBps)) || Number(slippageBps) < 0) {
                throw flowError('SLIPPAGE_INVALID', 'The slippage setting is invalid.', { stage: 'flow.start' })
            }

            const session = await gasAssistTraceStep(
                'flow.authenticate',
                { walletAddress },
                () => authenticateSponsorshipWallet({
                    quoteEndpoint,
                    walletAddress,
                    walletClient,
                }),
            )
            if (!isCurrent(walletEpoch, flowEpoch)) return
            sessionTokenRef.current = session.sessionToken

            const order = await gasAssistTraceStep(
                'flow.order-create',
                {
                    walletAddress,
                    sellToken: sellToken.address,
                    buyToken: buyToken.isNative ? 'native' : buyToken.address,
                    grossInputAmount,
                    slippageBps,
                },
                () => createSponsorshipOrder(quoteEndpoint, session.sessionToken, {
                    sellToken: sellToken.address,
                    buyToken: buyToken.isNative ? 'native' : buyToken.address,
                    grossInputAmount,
                    slippageBps,
                }, createIdempotencyKey()),
            )
            if (!isCurrent(walletEpoch, flowEpoch)) return
            setState({ ...initial, open: true, phase: 'review', config, order })
        } catch (error) {
            publishFailure(error, { walletEpoch, flowEpoch, keepOrder: false })
        } finally {
            finishOperation(operation)
        }
    }, [beginOperation, buyToken, capability.rawTransactionSigningSupported, config, configError, configStatus, connection.connector?.id, finishOperation, grossInputAmount, isCurrent, publishFailure, quoteEndpoint, sellToken, slippageBps, walletAddress, walletClient])

    const signIntent = useCallback(async (action) => {
        const operation = `${action}-intent`
        if (!beginOperation(operation)) return
        const order = state.order
        const sessionToken = sessionTokenRef.current
        const walletEpoch = walletEpochRef.current
        const flowEpoch = flowEpochRef.current
        try {
            if (!order || !sessionToken || !walletClient || !walletAddress) {
                throw flowError(
                    'SPONSORSHIP_CONTEXT_MISSING',
                    'The Gas Assist session is no longer available. Start again.',
                    { stage: `${action}.prepare` },
                )
            }
            setState((current) => ({ ...current, phase: `${action}-preparing`, error: null }))
            const intent = await gasAssistTraceStep(
                `flow.${action}-prepare`,
                { orderId: order.id },
                () => action === 'payment'
                    ? prepareSponsorshipPayment(quoteEndpoint, sessionToken, order.id)
                    : prepareSponsorshipApproval(quoteEndpoint, sessionToken, order.id),
            )
            if (!isCurrent(walletEpoch, flowEpoch)) return
            setState((current) => ({
                ...current,
                phase: `${action}-signing`,
                intentExpiresAt: intent.expiresAt,
            }))
            await signPreparedSponsoredTransaction({
                transport: capability.transport,
                capability,
                walletClient,
                preparedTransaction: intent.transaction,
                authenticatedWalletAddress: walletAddress,
                multichainAccount: walletAddress,
                action,
                submitSignedTransaction: async (signedRawTransaction) => {
                    if (!isCurrent(walletEpoch, flowEpoch)) {
                        throw flowError(
                            'PISTACHIO_ACCOUNT_MISMATCH',
                            'The connected wallet changed during signing.',
                            { stage: `${action}.submit` },
                        )
                    }
                    if (Date.parse(intent.expiresAt) <= Date.now()) {
                        throw flowError(
                            'INTENT_EXPIRED',
                            'The sponsored intent expired. Request a fresh intent.',
                            { stage: `${action}.submit` },
                        )
                    }
                    if (submittedIntentIdsRef.current.has(intent.intentId)) {
                        throw flowError(
                            'INTENT_ALREADY_USED',
                            'This sponsored intent was already submitted.',
                            { stage: `${action}.submit` },
                        )
                    }
                    submittedIntentIdsRef.current.add(intent.intentId)
                    try {
                        return await submitSponsorshipIntent(
                            quoteEndpoint,
                            sessionToken,
                            intent.intentId,
                            signedRawTransaction,
                        )
                    } catch (error) {
                        submittedIntentIdsRef.current.delete(intent.intentId)
                        throw error
                    }
                },
            })
            if (!isCurrent(walletEpoch, flowEpoch)) return
            setState((current) => ({
                ...current,
                phase: `${action}-confirming`,
                intentExpiresAt: null,
            }))
        } catch (error) {
            publishFailure(error, { walletEpoch, flowEpoch })
        } finally {
            finishOperation(operation)
        }
    }, [beginOperation, capability, finishOperation, isCurrent, publishFailure, quoteEndpoint, state.order, walletAddress, walletClient])

    const signPackage = useCallback(async () => {
        const operation = 'package'
        if (!beginOperation(operation)) return
        const order = state.order
        const sessionToken = sessionTokenRef.current
        const walletEpoch = walletEpochRef.current
        const flowEpoch = flowEpochRef.current
        try {
            if (!order || !sessionToken || !walletClient || !walletAddress) {
                throw flowError(
                    'SPONSORSHIP_CONTEXT_MISSING',
                    'The Gas Assist session is no longer available. Start again.',
                    { stage: 'package.prepare' },
                )
            }
            setState((current) => ({ ...current, phase: 'package-preparing', error: null }))
            const preparedPackage = await gasAssistTraceStep(
                'flow.package-prepare',
                { orderId: order.id },
                () => prepareSponsorshipPackage(
                    quoteEndpoint,
                    sessionToken,
                    order.id,
                ),
            )
            if (!isCurrent(walletEpoch, flowEpoch)) return
            setState((current) => ({
                ...current,
                phase: 'package-signing',
                intentExpiresAt: preparedPackage.expiresAt,
            }))
            await signPreparedSponsoredPackage({
                transport: capability.transport,
                capability,
                walletClient,
                preparedPackage,
                authenticatedWalletAddress: walletAddress,
                multichainAccount: walletAddress,
                submitSignedPackage: async (signedTransactions) => {
                    if (!isCurrent(walletEpoch, flowEpoch)) {
                        throw flowError(
                            'PISTACHIO_ACCOUNT_MISMATCH',
                            'The connected wallet changed during package signing.',
                            { stage: 'package.submit' },
                        )
                    }
                    if (Date.parse(preparedPackage.expiresAt) <= Date.now()) {
                        throw flowError(
                            'INTENT_EXPIRED',
                            'The signed transaction package expired.',
                            { stage: 'package.submit' },
                        )
                    }
                    return submitSponsorshipPackage(
                        quoteEndpoint,
                        sessionToken,
                        order.id,
                        signedTransactions,
                    )
                },
            })
            if (!isCurrent(walletEpoch, flowEpoch)) return
            setState((current) => ({
                ...current,
                phase: 'payment-confirming',
                intentExpiresAt: null,
                order: { ...current.order, preSignedPackage: true },
            }))
        } catch (error) {
            publishFailure(error, { walletEpoch, flowEpoch })
        } finally {
            finishOperation(operation)
        }
    }, [beginOperation, capability, finishOperation, isCurrent, publishFailure, quoteEndpoint, state.order, walletAddress, walletClient])

    const requestContinuation = useCallback(async () => {
        const operation = 'continuation-prepare'
        if (!beginOperation(operation)) return
        const sessionToken = sessionTokenRef.current
        const walletEpoch = walletEpochRef.current
        const flowEpoch = flowEpochRef.current
        const order = state.order
        try {
            if (!order || !sessionToken) {
                throw flowError(
                    'SPONSORSHIP_CONTEXT_MISSING',
                    'The Gas Assist session is no longer available. Start again.',
                    { stage: 'continuation.prepare' },
                )
            }
            setState((current) => ({ ...current, phase: 'continuation-loading', error: null }))
            const continuation = await gasAssistTraceStep(
                'flow.continuation-prepare',
                { orderId: order.id },
                () => prepareSponsorshipContinuation(
                    quoteEndpoint,
                    sessionToken,
                    order.id,
                ),
            )
            if (!isCurrent(walletEpoch, flowEpoch)) return
            setState((current) => ({ ...current, phase: 'continuation-ready', continuation }))
        } catch (error) {
            publishFailure(error, { walletEpoch, flowEpoch })
        } finally {
            finishOperation(operation)
        }
    }, [beginOperation, finishOperation, isCurrent, publishFailure, quoteEndpoint, state.order])

    const signContinuation = useCallback(async () => {
        const operation = 'continuation-sign'
        if (!beginOperation(operation)) return
        const intent = state.continuation
        const sessionToken = sessionTokenRef.current
        const walletEpoch = walletEpochRef.current
        const flowEpoch = flowEpochRef.current
        try {
            if (!intent || !sessionToken || !walletClient || !walletAddress) {
                throw flowError(
                    'SPONSORSHIP_CONTEXT_MISSING',
                    'The sponsored swap is no longer available. Prepare it again.',
                    { stage: 'continuation.sign' },
                )
            }
            setState((current) => ({
                ...current,
                phase: 'swap-signing',
                error: null,
                intentExpiresAt: intent.expiresAt,
            }))
            await signPreparedSponsoredTransaction({
                transport: capability.transport,
                capability,
                walletClient,
                preparedTransaction: intent.transaction,
                authenticatedWalletAddress: walletAddress,
                multichainAccount: walletAddress,
                action: 'normal-swap',
                submitSignedTransaction: async (signedRawTransaction) => {
                    if (!isCurrent(walletEpoch, flowEpoch)) {
                        throw flowError(
                            'PISTACHIO_ACCOUNT_MISMATCH',
                            'The connected wallet changed during signing.',
                            { stage: 'continuation.submit' },
                        )
                    }
                    if (Date.parse(intent.expiresAt) <= Date.now()) {
                        throw flowError(
                            'INTENT_EXPIRED',
                            'The sponsored swap intent expired. Request a fresh intent.',
                            { stage: 'continuation.submit' },
                        )
                    }
                    if (submittedIntentIdsRef.current.has(intent.intentId)) {
                        throw flowError(
                            'INTENT_ALREADY_USED',
                            'This sponsored swap intent was already submitted.',
                            { stage: 'continuation.submit' },
                        )
                    }
                    submittedIntentIdsRef.current.add(intent.intentId)
                    try {
                        return await submitSponsorshipIntent(
                            quoteEndpoint,
                            sessionToken,
                            intent.intentId,
                            signedRawTransaction,
                        )
                    } catch (error) {
                        submittedIntentIdsRef.current.delete(intent.intentId)
                        throw error
                    }
                },
            })
            if (!isCurrent(walletEpoch, flowEpoch)) return
            setState((current) => ({
                ...current,
                phase: 'swap-confirming',
                intentExpiresAt: null,
            }))
        } catch (error) {
            publishFailure(error, { walletEpoch, flowEpoch })
        } finally {
            finishOperation(operation)
        }
    }, [beginOperation, capability, finishOperation, isCurrent, publishFailure, quoteEndpoint, state.continuation, walletAddress, walletClient])

    useEffect(() => {
        const sessionToken = sessionTokenRef.current
        const orderId = state.order?.id
        const walletEpoch = walletEpochRef.current
        const flowEpoch = flowEpochRef.current
        if (!state.open || !orderId || !sessionToken ||
            ['completed', 'expired', 'rejected', 'failed'].includes(state.order.status)) return undefined
        const controller = new AbortController()
        const timer = window.setTimeout(async () => {
            gasAssistTrace('flow.poll.start', { orderId })
            try {
                const order = await fetchSponsorshipOrder(
                    quoteEndpoint,
                    sessionToken,
                    orderId,
                    controller.signal,
                )
                if (controller.signal.aborted || !isCurrent(walletEpoch, flowEpoch)) return
                setState((current) => {
                    if (current.order?.id !== orderId) return current
                    return {
                        ...current,
                        order: { ...current.order, ...order },
                        phase: phaseForOrderStatus(order.status, current.phase),
                        error: ['rejected', 'failed'].includes(order.status)
                            ? current.error ?? flowError(
                                'SPONSORSHIP_ORDER_FAILED',
                                'The sponsored swap could not be completed.',
                                { stage: 'order.poll', status: order.status },
                            )
                            : current.error,
                        lastPollError: null,
                        pollRevision: (current.pollRevision ?? 0) + 1,
                    }
                })
                gasAssistTrace('flow.poll.success', {
                    orderId,
                    status: order.status,
                    requiredAction: order.currentRequiredAction,
                })
                if (order.status === 'completed' && !confirmedOrderIdsRef.current.has(orderId)) {
                    confirmedOrderIdsRef.current.add(orderId)
                    await onConfirmed?.()
                }
            } catch (error) {
                if (!controller.signal.aborted && isCurrent(walletEpoch, flowEpoch)) {
                    gasAssistTraceError('flow.poll.error', error, { orderId })
                    setState((current) => {
                        if (current.order?.id !== orderId) return current
                        return {
                            ...current,
                            lastPollError: error,
                            pollRevision: (current.pollRevision ?? 0) + 1,
                        }
                    })
                }
            }
        }, 3_000)
        return () => {
            controller.abort()
            window.clearTimeout(timer)
        }
    }, [isCurrent, onConfirmed, quoteEndpoint, state.open, state.order, state.pollRevision])

    const close = useCallback(() => {
        if (state.phase.endsWith('-signing') ||
            state.phase.endsWith('-preparing') ||
            state.phase === 'authenticating' ||
            state.phase === 'continuation-loading') return
        flowEpochRef.current += 1
        operationRef.current = null
        setState(initial)
        gasAssistTrace('flow.closed', { walletAddress })
    }, [state.phase, walletAddress])

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
        signPackage,
        signPayment: () => signIntent('payment'),
        signApproval: () => signIntent('approval'),
        requestContinuation,
        signContinuation,
    }
}
