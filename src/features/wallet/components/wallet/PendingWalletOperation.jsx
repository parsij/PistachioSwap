import {
    useEffect,
    useSyncExternalStore,
} from 'react'
import {
    Check,
    X,
} from 'lucide-react'
import {
    AnimatePresence,
    motion,
} from 'motion/react'

import {
    getOptimisticWalletBalanceRevision,
    getWalletOperationDisplayState,
    subscribeOptimisticWalletBalances,
} from '../../services/optimisticBalances.js'
import { reconcilePendingWalletOperations } from '../../services/reconcilePendingWalletOperations.js'
import './walletPendingOperation.css'

const RECEIPT_POLL_MS = 4_000

function operationLabel(operation, status) {
    if (status === 'confirmed') {
        if (operation === 'sending') return 'Sent'
        if (operation === 'swapping') return 'Swapped'
        return 'Confirmed'
    }
    if (status === 'failed') {
        if (operation === 'sending') return 'Send failed'
        if (operation === 'swapping') return 'Swap failed'
        return 'Failed'
    }
    if (operation === 'sending') return 'Sending'
    if (operation === 'swapping') return 'Swapping'
    return 'Pending'
}

function operationTitle(status) {
    if (status === 'confirmed') return 'Transaction confirmed'
    if (status === 'failed') return 'Transaction failed'
    return 'Transaction submitted and waiting for settlement'
}

function OperationMark({ status }) {
    return (
        <span className="uni-wallet-operation-mark" aria-hidden="true">
            <AnimatePresence mode="wait" initial={false}>
                {status === 'pending' ? (
                    <motion.span
                        key="pending"
                        className="uni-wallet-operation-spinner"
                        initial={{ opacity: 0, scale: 0.7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.65, rotate: 35 }}
                        transition={{ duration: 0.18 }}
                    />
                ) : (
                    <motion.span
                        key={status}
                        className="uni-wallet-operation-result"
                        initial={{ opacity: 0, scale: 0.45, rotate: status === 'failed' ? -20 : -25 }}
                        animate={{ opacity: 1, scale: 1, rotate: 0 }}
                        exit={{ opacity: 0, scale: 0.7 }}
                        transition={{
                            type: 'spring',
                            stiffness: 470,
                            damping: 25,
                            mass: 0.72,
                        }}
                    >
                        {status === 'confirmed'
                            ? <Check aria-hidden="true" />
                            : <X aria-hidden="true" />}
                    </motion.span>
                )}
            </AnimatePresence>
        </span>
    )
}

export default function PendingWalletOperation({ walletAddress }) {
    const revision = useSyncExternalStore(
        subscribeOptimisticWalletBalances,
        getOptimisticWalletBalanceRevision,
        getOptimisticWalletBalanceRevision,
    )
    const operation = getWalletOperationDisplayState(walletAddress)
    void revision

    useEffect(() => {
        if (!walletAddress) return undefined
        const controller = new AbortController()
        let timeoutId = null

        const poll = async () => {
            await reconcilePendingWalletOperations(walletAddress, {
                signal: controller.signal,
            })
            if (!controller.signal.aborted) {
                timeoutId = globalThis.setTimeout(poll, RECEIPT_POLL_MS)
            }
        }

        void poll()
        return () => {
            controller.abort()
            if (timeoutId !== null) globalThis.clearTimeout(timeoutId)
        }
    }, [walletAddress])

    return (
        <AnimatePresence initial={false} mode="popLayout">
            {operation && (
                <motion.div
                    key={operation.transactionHash}
                    className="uni-wallet-pending-operation"
                    data-status={operation.status}
                    role="status"
                    aria-live="polite"
                    title={operationTitle(operation.status)}
                    layout
                    initial={{ opacity: 0, y: -4, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -5, scale: 0.94, filter: 'blur(3px)' }}
                    transition={{
                        layout: {
                            type: 'spring',
                            stiffness: 420,
                            damping: 32,
                        },
                        opacity: { duration: 0.2 },
                        y: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
                        scale: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
                        filter: { duration: 0.18 },
                    }}
                >
                    <OperationMark status={operation.status} />
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.strong
                            key={`${operation.transactionHash}:${operation.status}`}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.16, ease: 'easeOut' }}
                        >
                            {operationLabel(operation.operation, operation.status)}
                        </motion.strong>
                    </AnimatePresence>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
