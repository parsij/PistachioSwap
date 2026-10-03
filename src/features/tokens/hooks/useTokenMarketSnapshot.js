import { useEffect, useRef, useState } from 'react'
import { fetchTokenMarketDetails } from '../services/tokenDetails.js'

/** Read-only market requests, isolated from wallet/quote execution. */
export function useTokenMarketSnapshot(token, period = '1D', enabled = true, withStats = false, chartStyle = 'line') {
    const identity = `${token?.chainId}:${String(token?.address ?? '').toLowerCase()}`
    const requestKey = `${identity}:${period}:${chartStyle}`
    const [snapshot, setSnapshot] = useState(null)
    const [statsSnapshot, setStatsSnapshot] = useState(null)
    const yearReady = useRef(null)

    useEffect(() => {
        if (!enabled || !token) return undefined
        const controller = new AbortController()
        setSnapshot({ key: requestKey, loading: true, market: null, error: null })
        fetchTokenMarketDetails(token, {
            period, includeYearStats: withStats && yearReady.current !== identity,
            signal: controller.signal, chartStyle,
        }).then((market) => {
            if (controller.signal.aborted) return
            if (withStats && market.stats) {
                setStatsSnapshot((current) => {
                    const previous = current?.identity === identity ? current.stats : {}
                    const stats = { ...previous }
                    for (const [key, value] of Object.entries(market.stats)) {
                        if (value != null || stats[key] == null) stats[key] = value
                    }
                    return { identity, stats }
                })
                if (market.stats.high52wUsd != null && market.stats.low52wUsd != null) yearReady.current = identity
            }
            setSnapshot({ key: requestKey, loading: false, market, error: null })
        }).catch((error) => {
            if (!controller.signal.aborted) setSnapshot({ key: requestKey, loading: false, market: null, error })
        })
        return () => controller.abort()
    }, [enabled, identity, period, requestKey, token, withStats, chartStyle])

    const current = snapshot?.key === requestKey ? snapshot : null
    return {
        market: current?.market ?? null,
        loading: enabled && Boolean(token) && (current?.loading ?? true),
        error: current?.error ?? null,
        stats: statsSnapshot?.identity === identity ? statsSnapshot.stats : null,
    }
}
