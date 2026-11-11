import { useCallback, useEffect, useRef, useState } from 'react'
import { useConnection, useWalletClient } from '#wallet-runtime'

import {
    authenticateSponsorshipWallet,
    createSponsorshipOrder,
    fetchSponsorshipConfig,
    fetchSponsorshipOrder,
    cancelSponsorshipOrder,
} from '../services/prepaidSponsorship.js'
import {
    gasAssistTrace,
    gasAssistTraceError,
    gasAssistTraceStep,
} from '../services/gasAssistTrace.js'
import {
    recoverSelfHostedUserOperation,
    prepareSelfHostedSponsorship,
    selfHostedFrontendEnabled,
    submitSelfHostedPaymasterUserOperation,
} from '../services/selfHostedPaymaster.js'
import {
    pendingUserOperations, removePendingUserOperation, dismissPendingUserOperation,
} from '../services/pendingUserOperations.js'
import { getGasAssistBaseUrl } from '../services/gasAssist.js'
import { isUserRejectedError } from '../../../services/swapTransaction.js'
import { withinReviewedQuoteBounds } from '../model/reviewedQuoteBounds.js'

const initial = {
    open: false,
    phase: 'idle',
    config: null,
    order: null,
    intentExpiresAt: null,
    continuation: null,
    reviewUpdated: false,
    error: null,
    lastPollError: null,
    pollRevision: 0,
}

function phaseForOrderStatus(status, currentPhase) {
    return {
        'payment-submitting': 'payment-confirming',
        cancelled: 'cancelled',
        'payment-submitted': 'payment-confirming',
        'payment-confirmed': 'payment-confirmed',
        'approval-submitted': 'approval-confirming',
        'approval-confirmed': 'approval-confirmed',
        'swap-submitted': 'swap-confirming',
        'atomic-submitting': 'swap-confirming',
        'atomic-submitted': 'swap-confirming',
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

function validTransactionHash(value) {
    const hash = String(value ?? '').trim().toLowerCase()
    return /^0x[a-f0-9]{64}$/.test(hash) ? hash : null
}

function normalizedReviewValue(value, { address = false } = {}) {
    if (value === null || value === undefined) return ''
    const normalized = String(value).trim()
    return address ? normalized.toLowerCase() : normalized
}

export function reviewedSponsorshipOrderChanged(reviewed, created) {
    if (!reviewed || !created) return true
    const fields = [
        ['walletAddress', true],
        ['recipient', true],
        ['destinationRecipient', true],
        ['refundRecipient', true],
        ['treasuryAddress', true],
        ['chainId', false],
        ['sellToken', true],
        ['buyToken', true],
        ['grossInputAmountRaw', false],
        ['netSwapAmountRaw', false],
        ['paymentToken', true],
        ['paymentAmountRaw', false],
        ['paymentTokenDecimals', false],
        ['tradeNotionalUsdMicros', false],
        ['fixedServiceFeeUsdMicros', false],
        ['platformFeeUsdMicros', false],
        ['commercialFeeUsdMicros', false],
        ['gasReserveUsdMicros', false],
        ['conversionCostUsdMicros', false],
        ['totalPrepaymentUsdMicros', false],
        ['estimatedPaymentGasUsdMicros', false],
        ['estimatedApprovalGasUsdMicros', false],
        ['estimatedSwapGasUsdMicros', false],
        ['gasMultiplierBps', false],
        ['quoteProvider', false],
        ['expectedOutputRaw', false],
        ['minimumOutputRaw', false],
        ['requiresApproval', false],
        ['approvalSpender', true],
        ['approvalAmountRaw', false],
        ['sponsoredFlow', false],
        ['billingMode', false],
        ['crossChainRouteId', false],
    ]
    return fields.some(([field, isAddress]) =>
        normalizedReviewValue(reviewed[field], { address: isAddress }) !==
        normalizedReviewValue(created[field], { address: isAddress }))
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
    onSubmitted,
    onRecovered,
    createOrder: createOrderOverride,
    previewOrder,
    recoveryKind = 'same-chain',
    oneConfirmationEnabled = false,
}) {
    const connection = useConnection()
    const sourceChainId = Number(sellToken?.chainId ?? 56)
    const { data: walletClient } = useWalletClient({ chainId: sourceChainId })
    const [config, setConfig] = useState(null)
    const [configStatus, setConfigStatus] = useState('idle')
    const [configError, setConfigError] = useState(null)
    const [state, setState] = useState(initial)
    const [recoveryRevision, setRecoveryRevision] = useState(0)
    const sessionTokenRef = useRef(null)
    const walletEpochRef = useRef(0)
    const flowEpochRef = useRef(0)
    const operationRef = useRef(null)
    const sendControllerRef = useRef(null)
    const pendingReviewCancellationRef = useRef(null)
    const confirmedOrderIdsRef = useRef(new Set())
    const submittedOrderIdsRef = useRef(new Set())
    const forceImmediatePollRef = useRef(false)
    const onConfirmedRef = useRef(onConfirmed)
    const onSubmittedRef = useRef(onSubmitted)
    const onRecoveredRef = useRef(onRecovered)
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

    const notifySubmitted = useCallback(async (submittedOrder, transactionHash) => {
        // Recovery is read-only. It can contain an old receipt hash while the
        // swap form holds a completely different new quote. NEVER publish the
        // recovered operation as a new submission or re-notify its bridge.
        if (submittedOrder?.recoveredFromStorage === true) return
        const orderId = submittedOrder?.id
        const hash = validTransactionHash(
            transactionHash ??
            submittedOrder?.swapTransactionHash ??
            submittedOrder?.atomicTransactionHash ??
            submittedOrder?.transactionHash,
        )
        if (!orderId || !hash || submittedOrderIdsRef.current.has(orderId)) return

        const callbackOrder = {
            ...submittedOrder,
            swapTransactionHash: hash,
            atomicTransactionHash: hash,
        }
        setState((current) => current.order?.id === orderId
            ? {
                  ...current,
                  order: {
                      ...current.order,
                      swapTransactionHash: hash,
                      atomicTransactionHash: hash,
                  },
              }
            : current)

        try {
            await onSubmittedRef.current?.(callbackOrder)
            submittedOrderIdsRef.current.add(orderId)
            gasAssistTrace('flow.submitted.published', {
                orderId,
                transactionHash: hash,
            })
        } catch (error) {
            // The transaction is already broadcast. A UI/reporting callback must
            // not turn that successful broadcast into a fake submission failure.
            gasAssistTraceError('flow.submitted.callback-error', error, {
                orderId,
                transactionHash: hash,
            })
        }
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
        onConfirmedRef.current = onConfirmed
    }, [onConfirmed])

    useEffect(() => {
        onSubmittedRef.current = onSubmitted
    }, [onSubmitted])

    useEffect(() => {
        onRecoveredRef.current = onRecovered
    }, [onRecovered])

    useEffect(() => {
        sendControllerRef.current?.abort()
        walletEpochRef.current += 1
        flowEpochRef.current += 1
        operationRef.current = null
        sessionTokenRef.current = null
        confirmedOrderIdsRef.current.clear()
        submittedOrderIdsRef.current.clear()
        setState(initial)
        gasAssistTrace('flow.wallet-context-reset', {
            walletAddress,
            connectorId: connection.connector?.id,
            quoteEndpoint,
        })
        return () => sendControllerRef.current?.abort()
    }, [connection.connector?.id, quoteEndpoint, walletAddress, sourceChainId])

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
        fetchSponsorshipConfig(quoteEndpoint, controller.signal, sourceChainId)
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
    }, [quoteEndpoint, walletAddress, sourceChainId])

    const reviewOrder = useCallback((order) => {
        if (!order?.id || order.isPreview !== true) {
            throw flowError(
                'SPONSORSHIP_PREVIEW_INVALID',
                'Gas Assist returned an invalid preview.',
                { stage: 'preview.open' },
            )
        }
        if (
            order.walletAddress &&
            String(order.walletAddress).toLowerCase() !== String(walletAddress).toLowerCase()
        ) {
            throw flowError(
                'PISTACHIO_ACCOUNT_MISMATCH',
                'The Gas Assist preview belongs to another wallet.',
                { stage: 'preview.open' },
            )
        }
        flowEpochRef.current += 1
        operationRef.current = null
        sessionTokenRef.current = null
        setState({ ...initial, open: true, phase: 'review', config, order })
        gasAssistTrace('flow.preview.opened', {
            walletAddress,
            previewId: order.id,
        })
    }, [config, walletAddress, recoveryKind])

    const openPreviewLoading = useCallback(() => {
        flowEpochRef.current += 1
        operationRef.current = null
        sessionTokenRef.current = null
        setState({ ...initial, open: true, phase: 'preview-loading', config })
        gasAssistTrace('flow.preview.loading', { walletAddress })
    }, [config, walletAddress, recoveryKind])

    const failPreview = useCallback((error) => {
        setState((current) => ({
            ...current,
            open: true,
            phase: 'failed',
            error,
        }))
    }, [])

    const start = useCallback(async () => {
        if (previewOrder) {
            reviewOrder(previewOrder)
            return
        }
        const operation = 'start'
        if (!beginOperation(operation)) return
        const walletEpoch = walletEpochRef.current
        const flowEpoch = ++flowEpochRef.current
        // Do not mount a modal focus trap while Pistachio Wallet is authenticating.
        // The wallet review must be the only active dialog during this handoff.
        setState({ ...initial, open: false, phase: 'authenticating', config })

        try {
            if (connection.connector?.id !== 'pistachio-local') {
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
            if (!selfHostedFrontendEnabled(config)) {
                throw flowError(
                    'SELF_HOSTED_PAYMASTER_UNAVAILABLE',
                    'Self-hosted ERC-4337 Gas Assist is unavailable.',
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

            // Opening Review now creates a real order. If a previous review
            // was dismissed, settle its cancellation before opening another.
            const pendingCancellation = pendingReviewCancellationRef.current
            if (pendingCancellation) await pendingCancellation
            if (!isCurrent(walletEpoch, flowEpoch)) return

            const session = await gasAssistTraceStep(
                'flow.authenticate',
                { walletAddress },
                () => authenticateSponsorshipWallet({
                    quoteEndpoint,
                    chainId: sourceChainId,
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
                () => {
                    const idempotencyKey = createIdempotencyKey()
                    return typeof createOrderOverride === 'function'
                        ? createOrderOverride({
                            sessionToken: session.sessionToken,
                            idempotencyKey,
                            walletAddress,
                            sellToken,
                            buyToken,
                            grossInputAmount,
                            slippageBps,
                        })
                        : createSponsorshipOrder(quoteEndpoint, session.sessionToken, {
                            sellToken: sellToken.address,
                            buyToken: buyToken.isNative ? 'native' : buyToken.address,
                            grossInputAmount,
                            slippageBps,
                        }, idempotencyKey)
                },
            )
            if (!isCurrent(walletEpoch, flowEpoch)) return
            setState({ ...initial, open: true, phase: 'review', config, order })
        } catch (error) {
            publishFailure(error, { walletEpoch, flowEpoch, keepOrder: false })
        } finally {
            finishOperation(operation)
        }
    }, [beginOperation, buyToken, config, configError, configStatus, connection.connector?.id, createOrderOverride, finishOperation, grossInputAmount, isCurrent, previewOrder, publishFailure, quoteEndpoint, reviewOrder, sellToken, slippageBps, walletAddress, walletClient, recoveryKind, sourceChainId])

    const signPackage = useCallback(async () => {
        // An older source/bridge operation must never block a new, independently
        // authenticated order. Only an already submitted *identical order ID*
        // is ineligible for signing again. submitOperation enforces this a
        // second time at the bundler boundary.
        if (state.order?.id && pendingUserOperations(walletAddress)
            .some((item) => item.orderId === state.order.id)) {
            setState((current) => ({ ...current, open: true, phase: 'confirmation-delayed' }))
            return
        }
        const operation = 'package'
        if (!beginOperation(operation)) return
        let order = state.order
        let sessionToken = sessionTokenRef.current
        const walletEpoch = walletEpochRef.current
        const flowEpoch = flowEpochRef.current
        try {
            if (!order || !walletClient || !walletAddress) {
                throw flowError(
                    'SPONSORSHIP_CONTEXT_MISSING',
                    'The Gas Assist session is no longer available. Start again.',
                    { stage: 'package.prepare' },
                )
            }
            if (!sessionToken) {
                setState((current) => ({ ...current, phase: 'authenticating', error: null }))
                const session = await gasAssistTraceStep(
                    'flow.authenticate',
                    { walletAddress },
                    () => authenticateSponsorshipWallet({
                        quoteEndpoint,
                        chainId: sourceChainId,
                        walletAddress,
                        walletClient,
                    }),
                )
                if (!isCurrent(walletEpoch, flowEpoch)) return
                sessionToken = session.sessionToken
                sessionTokenRef.current = sessionToken
            }
            if (order.isPreview === true) {
                const reviewedOrder = order
                order = await gasAssistTraceStep(
                    'flow.order-create',
                    {
                        walletAddress,
                        sellToken: sellToken?.address,
                        buyToken: buyToken?.isNative ? 'native' : buyToken?.address,
                        grossInputAmount,
                        slippageBps,
                    },
                    () => {
                        const idempotencyKey = createIdempotencyKey()
                        return typeof createOrderOverride === 'function'
                            ? createOrderOverride({
                                sessionToken,
                                idempotencyKey,
                                walletAddress,
                                sellToken,
                                buyToken,
                                grossInputAmount,
                                slippageBps,
                            })
                            : createSponsorshipOrder(quoteEndpoint, sessionToken, {
                                sellToken: sellToken.address,
                                buyToken: buyToken.isNative ? 'native' : buyToken.address,
                                grossInputAmount,
                                slippageBps,
                            }, idempotencyKey)
                    },
                )
                if (!isCurrent(walletEpoch, flowEpoch)) return
                if (reviewedSponsorshipOrderChanged(reviewedOrder, order) &&
                    !(oneConfirmationEnabled && withinReviewedQuoteBounds(reviewedOrder, order, reviewedSponsorshipOrderChanged))) {
                    gasAssistTrace('flow.order.requote-review-required', {
                        previewId: reviewedOrder.id,
                        orderId: order.id,
                    })
                    setState((current) => ({
                        ...current,
                        phase: 'review',
                        order,
                        reviewUpdated: true,
                        error: null,
                    }))
                    return
                }
                setState((current) => ({ ...current, order, reviewUpdated: false }))
            }
            if (!selfHostedFrontendEnabled(config)) {
                throw flowError(
                    'SELF_HOSTED_PAYMASTER_UNAVAILABLE',
                    'Self-hosted ERC-4337 Gas Assist is unavailable.',
                    { stage: 'paymaster.prepare' },
                )
            }
            setState((current) => ({ ...current, phase: 'package-preparing', error: null }))
            const prepared = await gasAssistTraceStep(
                'flow.atomic-prepare',
                { orderId: order.id },
                () => prepareSelfHostedSponsorship(quoteEndpoint, sessionToken, order.id),
            )
            if (!isCurrent(walletEpoch, flowEpoch)) return
            setState((current) => ({
                ...current,
                phase: 'package-signing',
                intentExpiresAt: prepared.expiresAt,
                order: current.order
                    ? {
                        ...current.order,
                        expiresAt: prepared.expiresAt ?? current.order.expiresAt,
                    }
                    : current.order,
            }))
            if (selfHostedFrontendEnabled(config)) {
                sendControllerRef.current = new AbortController()
                const submission = await submitSelfHostedPaymasterUserOperation({
                    signal: sendControllerRef.current.signal,
                    prepared,
                    order,
                    backendConfig: config,
                    quoteEndpoint,
                    sessionToken,
                    walletClient,
                    authenticatedWalletAddress: walletAddress,
                    useSingleConfirmation: oneConfirmationEnabled,
                    // The wallet asks separately when the combined review is off.
                    allowDelegationMigration: true,
                    // Display-only quote snapshot, tied to this submitted public
                    // operation. Recovery must never use it for a new signature.
                    reviewDisplay: {
                        grossInputAmountRaw: order.grossInputAmountRaw,
                        expectedOutputRaw: order.expectedOutputRaw,
                        paymentAmountRaw: order.paymentAmountRaw,
                        sellTokenDecimals: Number(sellToken?.decimals),
                        buyTokenDecimals: Number(buyToken?.decimals),
                        paymentTokenDecimals: Number(order.paymentTokenDecimals),
                        sellTokenSymbol: sellToken?.symbol,
                        buyTokenSymbol: buyToken?.symbol,
                        paymentTokenSymbol: order.paymentTokenSymbol ?? sellToken?.symbol,
                        totalPrepaymentUsdMicros: order.totalPrepaymentUsdMicros,
                        // Preserve identity and artwork for *this* submitted
                        // review, not the next token pair selected after reload.
                        // The recovery store validates these display-only fields.
                        sellTokenChainId: Number(sellToken?.chainId ?? sourceChainId),
                        sellTokenAddress: sellToken?.address,
                        sellTokenLogoURI: sellToken?.logoURI ?? sellToken?.logoUri ?? sellToken?.iconUrl,
                        buyTokenChainId: Number(buyToken?.chainId),
                        buyTokenAddress: buyToken?.address,
                        buyTokenLogoURI: buyToken?.logoURI ?? buyToken?.logoUri ?? buyToken?.iconUrl,
                    },
                    onBroadcast: ({ userOpHash }) => {
                        if (!isCurrent(walletEpoch, flowEpoch)) return
                        setState((current) => ({ ...current, phase: 'swap-confirming',
                            order: { ...order, userOpHash, atomicExecution: true,
                                status: 'atomic-submitting', sourceStatus: 'pending' } }))
                    },
                    onSubmitted: async ({ transactionHash, userOpHash }) => {
                        if (isCurrent(walletEpoch, flowEpoch)) {
                            await notifySubmitted({ ...order, userOpHash }, transactionHash)
                        }
                    },
                })
                if (!isCurrent(walletEpoch, flowEpoch)) return
                // A confirmed BSC source operation is not Polygon settlement.
                // The cross-chain route keeps polling its own destination status.
                const sourceConfirmed = submission.status === 'source-confirmed'
                const isCrossChain = Number(buyToken?.chainId ?? sourceChainId) !== sourceChainId
                const confirmed = sourceConfirmed && !isCrossChain
                const completedOrder = {
                    ...order,
                    userOpHash: submission.userOpHash,
                    swapTransactionHash: submission.transactionHash,
                    atomicTransactionHash: submission.transactionHash,
                    atomicExecution: true,
                    sourceStatus: sourceConfirmed ? 'confirmed' : 'pending',
                    destinationStatus: isCrossChain ? 'pending' : null,
                    status: confirmed ? 'completed' : 'atomic-submitted',
                }
                setState((current) => ['completed', 'failed'].includes(current.order?.status) ? current : ({
                    ...current,
                    phase: confirmed ? 'completed' : sourceConfirmed ? 'destination-pending' : 'confirmation-delayed',
                    intentExpiresAt: null,
                    order: { ...current.order, ...completedOrder },
                }))
                if (confirmed) removePendingUserOperation(order.id)
                if (confirmed && !confirmedOrderIdsRef.current.has(order.id)) {
                    await onConfirmedRef.current?.(completedOrder)
                    confirmedOrderIdsRef.current.add(order.id)
                }
                return
            }
        } catch (error) {
            const pending = pendingUserOperations(walletAddress).filter((item) => Boolean(item.routeId) === (recoveryKind === 'cross-chain'))[0]
            if (pending && isCurrent(walletEpoch, flowEpoch)) {
                setState((current) => ({ ...current, phase: 'confirmation-delayed', error: null,
                    order: { ...current.order, userOpHash: pending.userOpHash,
                        status: 'atomic-submitting', submissionAmbiguous: pending.ambiguous } }))
            } else {
                if (order?.id && !order.isPreview && sessionToken) {
                    try {
                        await cancelSponsorshipOrder(quoteEndpoint, sessionToken, order.id)
                    } catch (cleanupError) {
                        gasAssistTraceError('flow.order.cancel-error', cleanupError, { orderId: order.id })
                    }
                }
                publishFailure(error, { walletEpoch, flowEpoch })
            }
        } finally {
            finishOperation(operation)
        }
    }, [beginOperation, buyToken, config, createOrderOverride, finishOperation, grossInputAmount, isCurrent, notifySubmitted, publishFailure, quoteEndpoint, sellToken, slippageBps, state.order, walletAddress, walletClient, recoveryKind, sourceChainId, oneConfirmationEnabled])

    useEffect(() => {
        if (!walletAddress || !quoteEndpoint) return undefined
        const controller = new AbortController()
        let timer
        let attempt = 0
        let running = false
        const walletEpoch = walletEpochRef.current
        // Recover every pending order, never just the first stale record.
        // Rotate one record per tick to respect provider rate limits and
        // prioritize a newly submitted operation after page reload.
        const operations = pendingUserOperations(walletAddress)
            .filter((item) => Boolean(item.routeId) === (recoveryKind === 'cross-chain'))
            .toReversed()
        const latest = operations[0]
        if (latest) {
            setState((current) => current.order?.id === latest.orderId ||
                current.phase !== 'idle' ? current : {
                // Old operations continue background recovery without
                // unexpectedly reopening an expired dialog over a fresh quote.
                ...initial, open: !latest.dismissed &&
                    Date.now() - latest.timestamp < 10 * 60_000,
                phase: 'confirmation-delayed',
                order: { id: latest.orderId, userOpHash: latest.userOpHash,
                    walletAddress: latest.walletAddress, atomicExecution: true,
                    status: 'atomic-submitting', sourceStatus: 'pending',
                    recoveredFromStorage: true, reviewDisplay: latest.reviewDisplay,
                    submissionAmbiguous: latest.ambiguous },
            })
            gasAssistTrace('userop.recovery.started', { orderId: latest.orderId })
        }
        if (!latest) return () => controller.abort()
        const schedule = () => {
            const old = Date.now() - latest.timestamp > 24 * 60 * 60 * 1_000
            const delay = operations.length > 1
                ? old ? 15_000 : 5_000
                : old ? 60_000 : Math.min(15_000, 5_000 * (1 + attempt))
            timer = window.setTimeout(poll, delay)
        }
        async function poll() {
            if (controller.signal.aborted || running) return
            if (document.hidden) return
            const operation = operations[attempt % operations.length]
            running = true
            try {
                let recovered = await recoverSelfHostedUserOperation({ quoteEndpoint, operation, signal: controller.signal })
                if (operation.routeId) {
                    // A successful source UserOperation does not establish
                    // destination completion. Require a bound backend route
                    // result, not a balance change or source-only "completed".
                    let destination = null
                    if (recovered.sourceStatus === 'confirmed') {
                        try {
                            const response = await fetch(`${getGasAssistBaseUrl(quoteEndpoint)}/v1/cross-chain/routes/${encodeURIComponent(operation.routeId)}/sponsorship/recovery`, {
                                method: 'POST', headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ orderId: operation.orderId, walletAddress: operation.walletAddress, userOpHash: operation.userOpHash }),
                                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
                            })
                            if (response.ok) {
                                const routeRecovery = await response.json()
                                const route = routeRecovery.destination
                                if (route?.publicRouteId === operation.routeId &&
                                    Number(route.sourceChainId) === operation.chainId &&
                                    typeof route.sourceTransactionHash === 'string' &&
                                    route.sourceTransactionHash.toLowerCase() === String(recovered.transactionHash ?? '').toLowerCase()) {
                                    destination = route
                                }
                            }
                        } catch {
                            // Provider outages must not mask a source receipt or
                            // turn an unresolved destination into a failure.
                            gasAssistTrace('userop.recovery.destination-deferred', { routeId: operation.routeId })
                        }
                    }
                    const sourceFailed = recovered.sourceStatus === 'reverted' ||
                        (['failed', 'rejected'].includes(recovered.status) &&
                            recovered.sourceStatus !== 'confirmed')
                    recovered = {
                        ...recovered,
                        destinationStatus: destination?.status ?? null,
                        status: sourceFailed ? 'failed'
                            : destination?.status === 'completed' ? 'completed'
                            : ['failed', 'refunded'].includes(destination?.status) ? 'failed'
                            : 'atomic-submitted',
                    }
                }
                if (controller.signal.aborted || walletEpochRef.current !== walletEpoch) return
                const terminal = ['completed', 'failed', 'rejected'].includes(recovered.status)
                const phase = recovered.status === 'completed' ? 'completed'
                    : terminal || recovered.sourceStatus === 'reverted' ? 'failed'
                    : recovered.sourceStatus === 'confirmed' ? 'destination-pending'
                    : Date.now() - operation.timestamp > 24 * 60 * 60 * 1_000 ? 'confirmation-unresolved'
                    : Date.now() - operation.timestamp > 120_000 ? 'confirmation-delayed' : 'swap-confirming'
                gasAssistTrace(`userop.recovery.${phase}`, { orderId: operation.orderId, userOpHash: operation.userOpHash, transactionHash: recovered.transactionHash })
                const order = { id: operation.orderId, ...recovered,
                    swapTransactionHash: recovered.transactionHash, atomicTransactionHash: recovered.transactionHash,
                    atomicExecution: true, crossChainRouteId: operation.routeId,
                    recoveredFromStorage: true, reviewDisplay: operation.reviewDisplay }
                setState((current) => current.order?.id !== operation.orderId ? current : ({
                    ...current, order: { ...current.order, ...order }, phase,
                    error: phase === 'failed'
                        ? ['failed', 'refunded'].includes(recovered.destinationStatus)
                            ? flowError('CROSS_CHAIN_DESTINATION_FAILED',
                                'The destination provider reported a failed or refunded transfer. Check the route status; the source gas charge may not be refundable.')
                        : recovered.failureCode === 'PAYMASTER_NOT_SUBMITTED'
                            ? flowError('PAYMASTER_NOT_SUBMITTED', 'The sponsored operation was not confirmed on-chain before its authorization expired.')
                            : flowError('PAYMASTER_EXECUTION_REVERTED', 'The sponsored operation could not complete.')
                        : null,
                    lastPollError: null }))
                // A recovered receipt can update only its OLD, hash-bound
                // activity. It must not invoke onSubmitted, create a fresh
                // optimistic operation or attach today's selected token pair.
                if (recovered.transactionHash && (recovered.sourceStatus === 'confirmed' || terminal)) {
                    try {
                        await onRecoveredRef.current?.(order, phase)
                    } catch (error) {
                        gasAssistTraceError('userop.recovery.display-error', error, {
                            orderId: operation.orderId,
                        })
                    }
                }
                if (terminal || recovered.sourceStatus === 'reverted') {
                    removePendingUserOperation(operation.orderId)
                    controller.abort()
                    setRecoveryRevision((revision) => revision + 1)
                    if (phase === 'completed' && !confirmedOrderIdsRef.current.has(operation.orderId)) {
                        confirmedOrderIdsRef.current.add(operation.orderId)
                        await onConfirmedRef.current?.(order)
                    }
                    return
                }
                attempt += 1
            } catch {
                // Receipt/RPC outages cannot establish execution failure.
                gasAssistTrace('userop.recovery.deferred', { orderId: operation.orderId })
                attempt += 1
            } finally { running = false }
            if (!controller.signal.aborted) schedule()
        }
        const visible = () => {
            window.clearTimeout(timer)
            if (!document.hidden) void poll()
        }
        document.addEventListener('visibilitychange', visible)
        void poll()
        return () => {
            controller.abort()
            window.clearTimeout(timer)
            document.removeEventListener('visibilitychange', visible)
        }
    }, [walletAddress, quoteEndpoint, state.order?.userOpHash, recoveryKind, recoveryRevision])

    const pollOrderId = state.order?.id ?? null
    const pollOrderIsPreview = state.order?.isPreview === true
    const pollOrderStatus = state.order?.status ?? null

    useEffect(() => {
        const sessionToken = sessionTokenRef.current
        const orderId = pollOrderId
        const walletEpoch = walletEpochRef.current
        const flowEpoch = flowEpochRef.current
        if (state.order?.userOpHash || !state.open || !orderId || pollOrderIsPreview || !sessionToken ||
            ['completed', 'expired', 'rejected', 'failed', 'cancelled'].includes(pollOrderStatus)) return undefined
        const controller = new AbortController()
        const delay = forceImmediatePollRef.current ? 0 : 3_000
        forceImmediatePollRef.current = false
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
                if (order.swapTransactionHash &&
                    !submittedOrderIdsRef.current.has(orderId)) {
                    await notifySubmitted(order, order.swapTransactionHash)
                }
                setState((current) => {
                    if (current.order?.id !== orderId) return current
                    return {
                        ...current,
                        order: { ...current.order, ...order },
                        phase: phaseForOrderStatus(order.status, current.phase),
                        error: ['rejected', 'failed'].includes(order.status)
                            ? current.error ?? flowError(
                                order.safeErrorCode || 'SPONSORSHIP_ORDER_FAILED',
                                'The sponsored swap could not be completed.',
                                {
                                    stage: 'order.poll',
                                    status: order.status,
                                    ...(order.safeErrorCode ? { rejectionCode: order.safeErrorCode } : {}),
                                },
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
                    await onConfirmedRef.current?.(order)
                    confirmedOrderIdsRef.current.add(orderId)
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
        }, delay)
        return () => {
            controller.abort()
            window.clearTimeout(timer)
        }
    }, [
        isCurrent,
        notifySubmitted,
        pollOrderId,
        pollOrderIsPreview,
        pollOrderStatus,
        quoteEndpoint,
        state.open,
        state.order?.userOpHash,
        state.pollRevision,
    ])

    useEffect(() => {
        if (!state.open) return undefined
        const onVisible = () => {
            if (document.hidden) return
            forceImmediatePollRef.current = true
            setState((current) => ({
                ...current,
                pollRevision: (current.pollRevision ?? 0) + 1,
            }))
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => document.removeEventListener('visibilitychange', onVisible)
    }, [state.open])

    const close = useCallback(() => {
        if (state.order?.userOpHash && !state.phase.endsWith('-signing')) {
            dismissPendingUserOperation(state.order.id, walletAddress)
            setState((current) => ({ ...current, open: false }))
            return
        }
        if (operationRef.current ||
            state.phase.endsWith('-signing') ||
            state.phase.endsWith('-preparing') ||
            state.phase.endsWith('-confirming') ||
            state.phase.endsWith('-submitting') ||
            state.phase === 'authenticating' ||
            state.phase === 'continuation-loading') return
        const order = state.order
        const sessionToken = sessionTokenRef.current
        if (state.phase === 'review' && order?.id && order.isPreview !== true &&
            !order.userOpHash && sessionToken && quoteEndpoint) {
            // A real quote now exists before review. Release abandoned orders
            // so closing/reopening the sheet cannot exhaust active-order slots.
            const cancellation = cancelSponsorshipOrder(
                quoteEndpoint, sessionToken, order.id,
            ).catch((error) => {
                gasAssistTraceError('flow.review-abandoned.cancel-error', error, {
                    orderId: order.id,
                })
            }).finally(() => {
                if (pendingReviewCancellationRef.current === cancellation) {
                    pendingReviewCancellationRef.current = null
                }
            })
            pendingReviewCancellationRef.current = cancellation
        }
        flowEpochRef.current += 1
        operationRef.current = null
        sessionTokenRef.current = null
        setState(initial)
        gasAssistTrace('flow.closed', { walletAddress })
    }, [quoteEndpoint, state.phase, state.order, walletAddress])

    return {
        ...state,
        config,
        configStatus,
        configError,
        walletAddress,
        retryStart: start,
        available: Boolean(required && config?.enabled),
        oneConfirmationEnabled,
        start,
        reviewOrder,
        openPreviewLoading,
        failPreview,
        close,
        signPackage,
    }
}
