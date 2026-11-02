import { useEffect, useRef } from 'react'

export const QUOTE_REFRESH_INTERVAL_MS = 30_000
export const QUOTE_SIGNING_HEADROOM_MS = 15_000

export function quoteNeedsRefresh(expiresAt, now = Date.now()) {
    const expiry = Date.parse(expiresAt)
    return !Number.isFinite(expiry) || expiry <= now + QUOTE_SIGNING_HEADROOM_MS
}

/** Refresh read-only reviews, never an operation that is being authorized/submitted. */
export function useAutomaticQuoteRefresh({ enabled, expiresAt, onRefresh }) {
    const refreshRef = useRef(onRefresh)
    refreshRef.current = onRefresh
    useEffect(() => {
        if (!enabled) return undefined
        const expiry = Date.parse(expiresAt)
        const delay = Number.isFinite(expiry)
            ? Math.max(1_000, Math.min(QUOTE_REFRESH_INTERVAL_MS, expiry - Date.now() - QUOTE_SIGNING_HEADROOM_MS))
            : QUOTE_REFRESH_INTERVAL_MS
        const dueAt = Date.now() + delay
        let fired = false
        const refresh = () => {
            if (fired || document.visibilityState === 'hidden') return
            if (Date.now() >= dueAt || quoteNeedsRefresh(expiresAt)) {
                fired = true
                void Promise.resolve().then(() => refreshRef.current?.()).catch(() => undefined)
            }
        }
        const timer = globalThis.setTimeout(refresh, delay)
        document.addEventListener('visibilitychange', refresh)
        return () => {
            globalThis.clearTimeout(timer)
            document.removeEventListener('visibilitychange', refresh)
        }
    }, [enabled, expiresAt])
}
