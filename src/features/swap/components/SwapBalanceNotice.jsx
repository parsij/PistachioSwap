import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'

const STALE_BALANCE_NOTICE = 'Showing previously loaded balances.'
export const STALE_BALANCE_NOTICE_DELAY_MS = 6_700

/**
 * Renders the wallet-balance freshness notice under the swap panels.
 * Cached balances are intentionally silent during the initial wallet refresh so
 * a normal fast load does not flash a warning before fresh balances arrive.
 * @param {{notice: string|null, onRetry: (() => void)|null}} props Notice text and optional retry callback.
 * @returns {import('react').ReactElement|null} Notice row, or nothing when balances are current.
 * @sideEffects Logs visible notices in development and invokes `onRetry` on click only.
 */
export default function SwapBalanceNotice({ notice, onRetry }) {
    const staleBalanceNotice = notice === STALE_BALANCE_NOTICE
    const [staleDelayElapsed, setStaleDelayElapsed] = useState(false)

    useEffect(() => {
        if (!staleBalanceNotice) {
            setStaleDelayElapsed(false)
            return undefined
        }

        setStaleDelayElapsed(false)
        const timer = window.setTimeout(
            () => setStaleDelayElapsed(true),
            STALE_BALANCE_NOTICE_DELAY_MS,
        )
        return () => window.clearTimeout(timer)
    }, [staleBalanceNotice])

    const visibleNotice = staleBalanceNotice && !staleDelayElapsed
        ? null
        : notice

    useEffect(() => {
        if (!visibleNotice || !import.meta.env.DEV) return
        console.warn('[wallet-balance-refresh]', visibleNotice)
    }, [visibleNotice])

    if (!visibleNotice) return null

    return (
        <p className="swap-balance-notice" role="status">
            <TriangleAlert aria-hidden="true" />
            <span>{visibleNotice}</span>
            {onRetry && (
                <button
                    type="button"
                    className="swap-balance-retry"
                    onClick={onRetry}
                >
                    Retry
                </button>
            )}
        </p>
    )
}
