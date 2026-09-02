import { useCallback, useEffect, useRef, useState } from 'react'

import { usePrepaidSponsorship } from '../../gas-assist/hooks/usePrepaidSponsorship.js'

/**
 * Sponsors the exact BNB Chain source transaction through the direct atomic
 * EIP-7702 Gas Assist flow. Cross-chain route mutation authentication remains
 * scoped to the prepared route; no sequential payment/approval package is used.
 */
export function useCrossChainGasAssist({
    quoteEndpoint,
    account,
    sellToken,
    buyToken,
    totalInputRaw,
    slippageBps,
    route,
    expected,
    preparation,
    sponsorshipConfig,
    previewSponsorship,
    authenticateSponsorship,
    prepareSponsorship,
    completeSponsorship,
    onConfirmed,
}) {
    const preparedResponseRef = useRef(null)
    const previewOperationRef = useRef(null)
    const previewResultRef = useRef(null)
    const contextRef = useRef(null)
    const currentContext = {
        account: String(account ?? '').toLowerCase(),
        routeId: route?.publicRouteId ?? null,
        grossInputAmount: String(totalInputRaw ?? ''),
    }
    const [previewStatus, setPreviewStatus] = useState('idle')
    const [previewError, setPreviewError] = useState(null)
    const [previewResult, setPreviewResult] = useState(null)
    const required = Boolean(
        (expected === true || (
            preparation?.status === 'ready' &&
            preparation?.insufficientNativeGas
        )) &&
        Number(sellToken?.chainId) === 56 &&
        sellToken?.isNative !== true,
    )

    const createOrder = useCallback(async ({ idempotencyKey }) => {
        const preparedRoute = preparedResponseRef.current?.preparedRoute
        if (!preparedRoute) {
            throw new Error('The cross-chain Gas Assist preview expired. Start again.')
        }
        await authenticateSponsorship(preparedRoute)
        const result = await prepareSponsorship(idempotencyKey)
        preparedResponseRef.current = result
        return result.order
    }, [authenticateSponsorship, prepareSponsorship])

    const handleSubmitted = useCallback(async (order) => {
        const prepared = preparedResponseRef.current
        if (!prepared?.preparedRoute || !order?.swapTransactionHash) {
            throw new Error('The sponsored cross-chain transaction is incomplete.')
        }
        await completeSponsorship({
            preparedRoute: prepared.preparedRoute,
            transactionHash: order.swapTransactionHash,
        })
    }, [completeSponsorship])

    const handleConfirmed = useCallback(async (order) => {
        await onConfirmed?.(order, preparedResponseRef.current?.preparedRoute)
    }, [onConfirmed])

    const sponsorship = usePrepaidSponsorship({
        quoteEndpoint,
        walletAddress: account,
        sellToken,
        buyToken,
        grossInputAmount: totalInputRaw,
        slippageBps: Math.max(30, slippageBps),
        required,
        createOrder,
        onSubmitted: handleSubmitted,
        onConfirmed: handleConfirmed,
    })
    const available = required && sponsorshipConfig?.enabled === true &&
        sponsorshipConfig?.atomicExecution === true &&
        typeof previewSponsorship === 'function' &&
        typeof authenticateSponsorship === 'function' &&
        typeof prepareSponsorship === 'function' &&
        typeof completeSponsorship === 'function'
    currentContext.key = [
        currentContext.account,
        currentContext.routeId,
        currentContext.grossInputAmount,
        available ? 'available' : 'unavailable',
    ].join(':')
    contextRef.current = currentContext

    const loadPreview = useCallback(async ({ minimumValidityMs = 0 } = {}) => {
        if (!available) return null
        const contextAtStart = { ...contextRef.current }
        const cached = previewResultRef.current
        const cachedExpiry = Date.parse(cached?.response?.order?.expiresAt ?? '')
        if (
            cached?.key === contextAtStart.key &&
            Number.isFinite(cachedExpiry) &&
            cachedExpiry > Date.now() + minimumValidityMs
        ) return cached.response

        const inFlight = previewOperationRef.current
        if (inFlight?.key === contextAtStart.key) return inFlight.promise

        setPreviewStatus('loading')
        setPreviewError(null)
        const promise = (async () => {
            const nextPreview = await previewSponsorship(route)
            if (
                contextRef.current.key !== contextAtStart.key ||
                nextPreview?.order?.grossInputAmountRaw !== contextAtStart.grossInputAmount
            ) return null
            const stored = { key: contextAtStart.key, response: nextPreview }
            previewResultRef.current = stored
            preparedResponseRef.current = nextPreview
            setPreviewResult(stored)
            setPreviewStatus('success')
            return nextPreview
        })()
        previewOperationRef.current = { key: contextAtStart.key, promise }

        try {
            return await promise
        } catch (error) {
            if (contextRef.current.key === contextAtStart.key) {
                previewResultRef.current = null
                preparedResponseRef.current = null
                setPreviewResult(null)
                setPreviewStatus('error')
                setPreviewError(error)
                console.error('[pistachio-swap] Cross-chain Gas Assist preview failed', {
                    code: error?.code ?? 'CROSS_CHAIN_GAS_ASSIST_PREVIEW_FAILED',
                    message: error?.message ?? 'Gas Assist preview failed.',
                    requestId: error?.requestId ?? null,
                })
            }
            throw error
        } finally {
            if (previewOperationRef.current?.promise === promise) {
                previewOperationRef.current = null
            }
        }
    }, [available, previewSponsorship, route])

    useEffect(() => {
        if (!available) {
            previewResultRef.current = null
            preparedResponseRef.current = null
            setPreviewResult(null)
            setPreviewStatus('idle')
            setPreviewError(null)
            return
        }
        void loadPreview().catch(() => undefined)
    }, [available, currentContext.key, loadPreview])

    async function start() {
        if (!available) return false
        sponsorship.openPreviewLoading()
        try {
            const nextPreview = await loadPreview({ minimumValidityMs: 15_000 })
            if (!nextPreview) return false
            sponsorship.reviewOrder(nextPreview.order)
            return true
        } catch (error) {
            sponsorship.failPreview(error)
            throw error
        }
    }

    const reviewSponsorship = {
        ...sponsorship,
        error: previewStatus === 'error' ? previewError : sponsorship.error,
        refreshing: previewStatus === 'loading' && sponsorship.open,
        refreshQuote: start,
    }

    return {
        required,
        expected: expected === true,
        available,
        grossInputAmount: totalInputRaw,
        preview: previewResult?.key === currentContext.key
            ? previewResult.response.order
            : null,
        previewRoute: previewResult?.key === currentContext.key
            ? previewResult.response.preparedRoute
            : null,
        status: !required
            ? 'idle'
            : previewStatus === 'loading' || available && previewStatus === 'idle'
                ? 'loading'
                : previewStatus === 'error'
                    ? 'error'
                    : sponsorship.configStatus === 'loading'
                        ? 'loading'
                        : available ? 'success' : 'unavailable',
        error: previewError ?? sponsorship.configError ?? sponsorship.error,
        sponsorship: reviewSponsorship,
        start,
    }
}
