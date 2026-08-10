import { useEffect, useMemo, useState } from 'react'

import { fetchSponsorshipPreview } from '../services/sponsorshipPreview.js'

function validRawAmount(value) {
    return /^[1-9]\d*$/u.test(String(value ?? ''))
}

/**
 * Debounces the non-mutating prepaid preview for low-BNB same-chain swaps.
 * This hook never asks the wallet to sign and never creates a sponsorship order.
 */
export function useSponsorshipPreview({
    quoteEndpoint,
    walletAddress,
    sellToken,
    buyToken,
    grossInputAmount,
    slippageBps,
    required,
    enabled,
    debounceMs = 350,
}) {
    const [preview, setPreview] = useState(null)
    const [status, setStatus] = useState('idle')
    const [error, setError] = useState(null)

    const request = useMemo(() => {
        if (!required || !enabled || !quoteEndpoint || !walletAddress) return null
        if (!sellToken?.address || !buyToken || (!buyToken.isNative && !buyToken.address)) return null
        if (!validRawAmount(grossInputAmount)) return null
        const parsedSlippage = Number(slippageBps)
        if (!Number.isInteger(parsedSlippage) || parsedSlippage < 30 || parsedSlippage > 10_000) return null
        return {
            walletAddress,
            sellToken: sellToken.address,
            buyToken: buyToken.isNative ? 'native' : buyToken.address,
            grossInputAmount: String(grossInputAmount),
            slippageBps: parsedSlippage,
        }
    }, [
        buyToken,
        enabled,
        grossInputAmount,
        quoteEndpoint,
        required,
        sellToken,
        slippageBps,
        walletAddress,
    ])

    const requestKey = useMemo(
        () => request ? JSON.stringify(request) : null,
        [request],
    )

    useEffect(() => {
        if (!request || !requestKey) {
            setPreview(null)
            setError(null)
            setStatus('idle')
            return undefined
        }

        const controller = new AbortController()
        setPreview(null)
        setError(null)
        setStatus('loading')
        const timeout = window.setTimeout(async () => {
            try {
                const next = await fetchSponsorshipPreview(
                    quoteEndpoint,
                    request,
                    controller.signal,
                )
                if (controller.signal.aborted) return
                setPreview(next)
                setError(null)
                setStatus('success')
            } catch (nextError) {
                if (controller.signal.aborted || nextError?.name === 'AbortError') return
                setPreview(null)
                setError(nextError)
                setStatus('error')
            }
        }, debounceMs)

        return () => {
            window.clearTimeout(timeout)
            controller.abort()
        }
    }, [debounceMs, quoteEndpoint, request, requestKey])

    return { preview, status, error }
}
