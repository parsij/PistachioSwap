import { useSyncExternalStore } from 'react'
import { RefreshCw } from 'lucide-react'

import {
    getOptimisticWalletBalanceRevision,
    getOptimisticWalletTransactions,
    subscribeOptimisticWalletBalances,
} from '../../services/optimisticBalances.js'
import './walletPendingOperation.css'

function operationLabel(operation) {
    if (operation === 'sending') return 'Sending'
    if (operation === 'swapping') return 'Swapping'
    return 'Pending'
}

export default function PendingWalletOperation({ walletAddress }) {
    const revision = useSyncExternalStore(
        subscribeOptimisticWalletBalances,
        getOptimisticWalletBalanceRevision,
        getOptimisticWalletBalanceRevision,
    )
    const transaction = getOptimisticWalletTransactions(walletAddress)[0] ?? null
    void revision

    if (!transaction) return null

    return (
        <div
            className="uni-wallet-pending-operation"
            role="status"
            aria-live="polite"
            title="Transaction submitted and waiting for settlement"
        >
            <span className="uni-wallet-pending-spinner" aria-hidden="true">
                <RefreshCw />
            </span>
            <strong>{operationLabel(transaction.operation)}</strong>
        </div>
    )
}
