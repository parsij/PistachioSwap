import { useEffect } from 'react'
import { TriangleAlert } from 'lucide-react'

/**
 * Renders the wallet-balance freshness notice under the swap panels.
 * @param {{notice: string|null, onRetry: (() => void)|null}} props Notice text and optional retry callback.
 * @returns {import('react').ReactElement|null} Notice row, or nothing when balances are current.
 * @sideEffects Logs the notice in development and invokes `onRetry` on click only.
 */
export default function SwapBalanceNotice({ notice, onRetry }) {
    useEffect(() => {
        if (!notice || !import.meta.env.DEV) return
        console.warn('[wallet-balance-refresh]', notice)
    }, [notice])

    if (!notice) return null

    return (
        <p className="swap-balance-notice" role="status">
            <TriangleAlert aria-hidden="true" />
            <span>{notice}</span>
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
