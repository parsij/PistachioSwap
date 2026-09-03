import { useCallback, useEffect, useRef, useState } from 'react'

import { usePrepaidSponsorship } from '../../gas-assist/hooks/usePrepaidSponsorship.js'
import { getGasAssistFeeBreakdown } from '../../gas-assist/model/gasAssistFee.js'

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
    routes = [],
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
    const candidateRoutesRef = useRef([])
    const candidateRoutes = []
    const seenRouteIds = new Set()
    for (const candidate of [route, ...(Array.isArray(routes) ? routes : [])]) {
        const routeId = String(candidate?.publicRouteId ?? '')
        if (!routeId || seenRouteIds.has(routeId)) continue
        seenRouteIds.add(routeId)
        candidateRoutes.push(candidate)
    }
    candidateRoutesRef.current = candidateRoutes
    const grossInputAmount = String(totalInputRaw ?? '')
    const routeSetKey = candidateRoutes
        .map((candidate) => String(candidate.publicRouteId))
        .join(',')
    const routeReady = candidateRoutes.length > 0 && /^[1-9]\d*$/.test(grossInputAmount)
    const currentContext = {
        account: String(account ?? '').toLowerCase(),
        routeSetKey,
        grossInputAmount,
    }
    const [previewStatus, setPreviewStatus] = useState('idle')
    const [previewError, setPreviewError] = useState(null)
    const [previewResult, setPreviewResult] = useState(null)
    const eligible = Boolean(
        (expected === true || (
            preparation?.status === 'ready' &&
            preparation?.insufficientNativeGas
        )) &&
        Number(sellToken?.chainId) === 56 &&
        sellToken?.isNative !== true,
    )
    const required = Boolean(
        preparation?.status === 'ready' &&
        preparation?.insufficientNativeGas &&
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
        required: eligible,
        createOrder,
        onSubmitted: handleSubmitted,
        onConfirmed: handleConfirmed,
    })
    const available = eligible && sponsorshipConfig?.enabled === true &&
        sponsorshipConfig?.atomicExecution === true &&
        typeof previewSponsorship === 'function' &&
        typeof authenticateSponsorship === 'function' &&
        typeof prepareSponsorship === 'function' &&
        typeof completeSponsorship === 'function'
    currentContext.key = [
        currentContext.account,
        currentContext.routeSetKey,
        currentContext.grossInputAmount,
        available ? 'available' : 'unavailable',
    ].join(':')
    contextRef.current = currentContext

    const loadPreview = useCallback(async ({ minimumValidityMs = 0 } = {}) => {
        if (!available || !routeReady) return null
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
            let lastError = null
            for (const candidateRoute of candidateRoutesRef.current) {
                if (contextRef.current.key !== contextAtStart.key) return null
                try {
                    const nextPreview = await previewSponsorship(candidateRoute)
                    if (contextRef.current.key !== contextAtStart.key) return null
                    if (nextPreview?.order?.grossInputAmountRaw !== contextAtStart.grossInputAmount) {
                        lastError = Object.assign(
                            new Error('Gas Assist returned a quote for a different gross input.'),
                            { code: 'CROSS_CHAIN_GAS_ASSIST_INPUT_MISMATCH' },
                        )
                        continue
                    }
                    if (!getGasAssistFeeBreakdown(nextPreview?.order)) {
                        lastError = Object.assign(
                            new Error('Gas Assist route costs are not economically valid for this amount.'),
                            { code: 'CROSS_CHAIN_GAS_ASSIST_QUOTE_UNECONOMIC' },
                        )
                        continue
                    }
                    const stored = { key: contextAtStart.key, response: nextPreview }
                    previewResultRef.current = stored
                    preparedResponseRef.current = nextPreview
                    setPreviewResult(stored)
                    setPreviewStatus('success')
                    return nextPreview
                } catch (error) {
                    lastError = error
                }
            }
            throw lastError ?? Object.assign(
                new Error('No economically valid Gas Assist route is available for this amount.'),
                { code: 'CROSS_CHAIN_GAS_ASSIST_NO_ECONOMIC_ROUTE' },
            )
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
    }, [available, previewSponsorship, routeReady])

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
        eligible,
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
        status: !eligible
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
