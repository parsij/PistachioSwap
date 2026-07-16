import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWalletClient } from 'wagmi'

import {
    createGaslessQuote,
    fetchGasAssistConfig,
    fetchGaslessStatus,
    signZeroXTypedData,
    submitGaslessQuote,
} from '../services/gasAssist.js'
import { isUserRejectedError } from '../services/swapTransaction.js'

const initial = { open: false, state: 'idle', quote: null, error: null, tradeHash: null, transactionHash: null }

export function useZeroXGaslessSwap({
    quoteEndpoint,
    walletAddress,
    sellToken,
    sellAmount,
    slippageBps,
    enabled,
    onConfirmed,
}) {
    const { data: walletClient } = useWalletClient({ chainId: 56 })
    const [config, setConfig] = useState(null)
    const [dialog, setDialog] = useState(initial)

    useEffect(() => {
        if (!enabled || !quoteEndpoint) return undefined
        const controller = new AbortController()
        fetchGasAssistConfig(quoteEndpoint, controller.signal)
            .then(setConfig)
            .catch(() => setConfig({ enabled: false }))
        return () => controller.abort()
    }, [enabled, quoteEndpoint])

    const request = useMemo(() => walletAddress && sellToken && sellAmount
        ? {
            chainId: 56,
            walletAddress,
            sellToken: sellToken.address,
            sellAmount,
            slippageBps,
        }
        : null, [sellAmount, sellToken, slippageBps, walletAddress])

    const open = useCallback(async () => {
        if (!request || !config?.enabled || sellToken?.isNative) return
        setDialog({ ...initial, open: true, state: 'quote-loading' })
        try {
            const quote = await createGaslessQuote(quoteEndpoint, request)
            setDialog({ ...initial, open: true, state: 'ready', quote })
        } catch (error) {
            setDialog({ ...initial, open: true, state: 'failed', error })
        }
    }, [config?.enabled, quoteEndpoint, request, sellToken?.isNative])

    const close = useCallback(() => {
        setDialog((current) => ['signing-approval', 'signing-trade', 'submitting'].includes(current.state)
            ? current
            : initial)
    }, [])

    const confirm = useCallback(async () => {
        const quote = dialog.quote
        if (!quote || !walletClient || !walletAddress) return
        if (Date.parse(quote.expiresAt) <= Date.now()) {
            setDialog((current) => ({ ...current, state: 'expired', error: { code: 'QUOTE_EXPIRED', message: 'The Gas Assist quote expired.' } }))
            return
        }
        let approvalSignature = null
        try {
            if (quote.approval) {
                setDialog((current) => ({ ...current, state: 'signing-approval', error: null }))
                approvalSignature = await signZeroXTypedData(walletClient, walletAddress, quote.approval.eip712)
            }
            setDialog((current) => ({ ...current, state: 'signing-trade', error: null }))
            const tradeSignature = await signZeroXTypedData(walletClient, walletAddress, quote.trade.eip712)
            setDialog((current) => ({ ...current, state: 'submitting' }))
            const submitted = await submitGaslessQuote(quoteEndpoint, {
                quoteId: quote.quoteId,
                approvalSignature,
                tradeSignature,
            })
            setDialog((current) => ({
                ...current,
                state: 'submitted',
                tradeHash: submitted.tradeHash,
                submittedAt: Date.now(),
            }))
        } catch (error) {
            setDialog((current) => ({
                ...current,
                state: isUserRejectedError(error) ? 'cancelled' : 'failed',
                error,
            }))
        }
    }, [dialog.quote, quoteEndpoint, walletAddress, walletClient])

    useEffect(() => {
        if (!dialog.tradeHash || !['submitted', 'pending', 'succeeded'].includes(dialog.state)) return undefined
        const controller = new AbortController()
        const delay = Math.max(config?.statusPollIntervalMs ?? 3000, 1000)
        const timeout = window.setTimeout(async () => {
            if (
                dialog.submittedAt &&
                Date.now() - dialog.submittedAt > (config?.statusTimeoutMs ?? 120000)
            ) {
                setDialog((current) => ({
                    ...current,
                    state: 'failed',
                    error: { code: 'STATUS_UNAVAILABLE', message: 'Trade status polling timed out.' },
                }))
                return
            }
            try {
                const status = await fetchGaslessStatus(quoteEndpoint, dialog.tradeHash, controller.signal)
                setDialog((current) => ({
                    ...current,
                    state: status.status,
                    transactionHash: status.transactionHash ?? current.transactionHash,
                }))
                if (status.status === 'confirmed') await onConfirmed?.()
            } catch (error) {
                if (!controller.signal.aborted) setDialog((current) => ({ ...current, error }))
            }
        }, delay)
        return () => {
            controller.abort()
            window.clearTimeout(timeout)
        }
    }, [config?.statusPollIntervalMs, config?.statusTimeoutMs, dialog.state, dialog.submittedAt, dialog.tradeHash, onConfirmed, quoteEndpoint])

    return { config, dialog, available: Boolean(config?.enabled && request && !sellToken?.isNative), open, close, confirm }
}
