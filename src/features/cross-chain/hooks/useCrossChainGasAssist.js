import { useCallback, useRef, useState } from 'react'

import { usePrepaidSponsorship } from '../../gas-assist/hooks/usePrepaidSponsorship.js'

/** Sponsors the exact BNB Chain source transaction through the normal MegaFuel package flow. */
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
    const previewOperationRef = useRef(false)
    const contextRef = useRef(null)
    contextRef.current = {
        account: String(account ?? '').toLowerCase(),
        routeId: route?.publicRouteId ?? null,
        grossInputAmount: String(totalInputRaw ?? ''),
    }
    const [previewStatus, setPreviewStatus] = useState('idle')
    const [previewError, setPreviewError] = useState(null)
    const required = Boolean(
        (expected === true || (
            preparation?.status === 'ready' &&
            preparation?.insufficientNativeGas
        )) &&
        Number(sellToken?.chainId) === 56 &&
        sellToken?.isNative !== true,
    )

    const createOrder = useCallback(async ({ idempotencyKey }) => {
        const result = await prepareSponsorship(idempotencyKey)
        preparedResponseRef.current = result
        return result.order
    }, [prepareSponsorship])

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

    const handleBeforeAuthenticate = useCallback(async () => {
        const preparedRoute = preparedResponseRef.current?.preparedRoute
        if (!preparedRoute) {
            throw new Error('The cross-chain Gas Assist preview expired. Start again.')
        }
        await authenticateSponsorship(preparedRoute)
    }, [authenticateSponsorship])

    const sponsorship = usePrepaidSponsorship({
        quoteEndpoint,
        walletAddress: account,
        sellToken,
        buyToken,
        grossInputAmount: totalInputRaw,
        slippageBps: Math.max(30, slippageBps),
        required,
        createOrder,
        beforeAuthenticate: handleBeforeAuthenticate,
        onSubmitted: handleSubmitted,
        onConfirmed: handleConfirmed,
    })
    const available = required && sponsorshipConfig?.enabled === true &&
        typeof previewSponsorship === 'function' &&
        typeof authenticateSponsorship === 'function' &&
        typeof prepareSponsorship === 'function' &&
        typeof completeSponsorship === 'function'

    async function start() {
        if (!available || previewOperationRef.current) return false
        previewOperationRef.current = true
        const contextAtStart = { ...contextRef.current }
        preparedResponseRef.current = null
        setPreviewStatus('loading')
        setPreviewError(null)
        try {
            const preview = await previewSponsorship(route)
            if (
                contextRef.current.account !== contextAtStart.account ||
                contextRef.current.routeId !== contextAtStart.routeId ||
                contextRef.current.grossInputAmount !== contextAtStart.grossInputAmount
            ) return false
            preparedResponseRef.current = preview
            sponsorship.reviewOrder(preview.order)
            setPreviewStatus('success')
            return true
        } catch (error) {
            setPreviewStatus('error')
            setPreviewError(error)
            console.error('[pistachio-swap] Cross-chain Gas Assist preview failed', {
                code: error?.code ?? 'CROSS_CHAIN_GAS_ASSIST_PREVIEW_FAILED',
                message: error?.message ?? 'Gas Assist preview failed.',
                requestId: error?.requestId ?? null,
            })
            throw error
        } finally {
            previewOperationRef.current = false
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
        preview: null,
        status: !required
            ? 'idle'
            : previewStatus === 'loading'
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
