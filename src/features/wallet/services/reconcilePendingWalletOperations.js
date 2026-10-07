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
    walletTransactionReceiptStatus,
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

export async function resolveExternalWalletOperationStatus(transaction, result, signal) {
    const status = String(result?.status ?? '').trim().toLowerCase()
    if (result?.publicRouteId && transaction.referenceId && result.publicRouteId !== transaction.referenceId) return 'pending'
    if (result?.sourceTransactionHash && String(result.sourceTransactionHash).toLowerCase() !== transaction.transactionHash.toLowerCase()) return 'pending'

    const sourceChainId = transaction.changes.find(change => BigInt(change.deltaRaw) < 0n)?.chainId
    if (result?.sourceChainId && result.sourceChainId !== sourceChainId) return 'pending'
    if (CROSS_CHAIN_TERMINAL_FAILURES.has(status)) return status

    // The source receipt confirms only the deposit. Completion needs the
    // destination receipt bound to this route and its expected output chain.
    const destinationChainId = transaction.changes.find(change => BigInt(change.deltaRaw) > 0n)?.chainId
    if (result?.destinationTransactionHash && (!destinationChainId || result.destinationChainId !== destinationChainId)) return 'pending'
    if (result?.destinationTransactionHash && destinationChainId && result.destinationChainId === destinationChainId) {
        try {
            const receipt = await walletTransactionReceiptStatus(result.destinationTransactionHash, destinationChainId, { signal })
            if (receipt === 'confirmed') return 'completed'
            if (receipt === 'failed') return 'failed'
            return 'pending'
        } catch {
            return 'pending'
        }
    }
    if (status === 'completed') return status
    try {
        const source = await walletTransactionReceiptStatus(transaction.transactionHash, sourceChainId, { signal })
        if (source === 'failed') return 'failed'
    } catch {
        // Missing or unreachable RPC is never evidence of success or failure.
    }
    return status || 'pending'
}

async function reconcileExternalOperation(transaction, routeId, signal) {
    if (!routeId) return
    try {
        const result = await fetchCrossChainRouteStatus({
            endpoint: `${apiBaseUrl}/v1/cross-chain`,
            routeId,
            signal,
        })
        const status = await resolveExternalWalletOperationStatus(transaction, result, signal)
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
 * pending until their destination receipt or provider confirms settlement.
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
