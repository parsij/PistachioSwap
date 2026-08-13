import { useCallback, useRef } from 'react'

import { usePrepaidSponsorship } from '../../gas-assist/hooks/usePrepaidSponsorship.js'

/** Sponsors the exact BNB Chain source transaction through the normal MegaFuel package flow. */
export function useCrossChainGasAssist({
    quoteEndpoint,
    account,
    sellToken,
    buyToken,
    totalInputRaw,
    slippageBps,
    preparation,
    sponsorshipConfig,
    prepareSponsorship,
    completeSponsorship,
    onConfirmed,
}) {
    const preparedResponseRef = useRef(null)
    const required = Boolean(
        preparation?.status === 'ready' &&
        preparation?.insufficientNativeGas &&
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
        typeof prepareSponsorship === 'function' &&
        typeof completeSponsorship === 'function'

    async function start() {
        if (!available) return false
        preparedResponseRef.current = null
        await sponsorship.start()
        return true
    }

    return {
        required,
        available,
        grossInputAmount: totalInputRaw,
        preview: null,
        status: !required
            ? 'idle'
            : sponsorship.configStatus === 'loading'
                ? 'loading'
                : available ? 'success' : 'unavailable',
        error: sponsorship.configError ?? sponsorship.error,
        sponsorship,
        start,
    }
}
