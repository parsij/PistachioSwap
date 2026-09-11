import { apiBaseUrl } from '../../../lib/apiBaseUrl.js'
import {
    fetchCrossChainRouteStatus,
    PUBLIC_ROUTE_STORAGE_KEY,
} from '../../cross-chain/services/crossChainRoutes.js'
import {
    finishOptimisticWalletTransaction,
    getOptimisticWalletTransactions,
    reconcilePersistedWalletTransactions,
    rollbackOptimisticWalletTransaction,
} from './optimisticBalances.js'

const CROSS_CHAIN_TERMINAL_FAILURES = new Set([
    'failed',
    'expired',
    'refunded',
])

function readPersistedRouteId() {
    try {
        const value = String(globalThis.localStorage?.getItem(PUBLIC_ROUTE_STORAGE_KEY) ?? '').trim()
        return value || null
    } catch {
        return null
    }
}

async function reconcileExternalOperation(transaction, routeId, signal) {
    if (!routeId) return
    try {
        const result = await fetchCrossChainRouteStatus({
            endpoint: `${apiBaseUrl}/v1/cross-chain`,
            routeId,
            signal,
        })
        const status = String(result?.status ?? '').trim().toLowerCase()
        if (status === 'completed') {
            finishOptimisticWalletTransaction(transaction.transactionHash)
        } else if (CROSS_CHAIN_TERMINAL_FAILURES.has(status)) {
            rollbackOptimisticWalletTransaction(transaction.transactionHash)
        }
    } catch {
        // A temporary status/RPC failure is not transaction failure. Keep the
        // operation pending and try again on the next poll.
    }
}

/**
 * Reconciles persisted pending UI state after a reload. Same-chain operations
 * are checked against their source-chain receipt; cross-chain operations stay
 * pending until the route itself reaches a terminal state.
 */
export async function reconcilePendingWalletOperations(walletAddress, { signal } = {}) {
    await reconcilePersistedWalletTransactions(walletAddress, { signal })
    if (signal?.aborted) return

    const external = getOptimisticWalletTransactions(walletAddress)
        .filter((transaction) => transaction.settlementMode === 'external')
    if (external.length === 0) return

    const fallbackRouteId = readPersistedRouteId()
    await Promise.all(external.map((transaction, index) =>
        reconcileExternalOperation(
            transaction,
            transaction.referenceId ?? (index === 0 ? fallbackRouteId : null),
            signal,
        )))
}
