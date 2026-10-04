import { CheckCircle2, CircleX, ExternalLink, LoaderCircle } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

import TokenIcon from '../../../tokens/components/TokenIcon.jsx'

/** Returns the selected chain explorer URL for an EVM transaction hash. */
export function transactionExplorerUrl(explorerUrl, hash) {
    const base = String(explorerUrl ?? '').trim().replace(/\/+$/u, '')
    const normalized = String(hash ?? '').trim()
    return base && normalized ? `${base}/tx/${normalized}` : null
}

/** Presents wallet transfer pending/success/failure status and optional explorer link. */
export default function TransactionStatusDialog({
    status,
    hash,
    token = null,
    explorerUrl = null,
    explorerName = null,
}) {
    const reducedMotion = useReducedMotion()
    if (status === 'idle' || status === 'review') return null
    const pending = status === 'confirming' || status === 'sending' || status === 'submitted'
    const failed = status === 'failed' || status === 'rejected'
    const transactionUrl = transactionExplorerUrl(explorerUrl, hash)
    const explorerLabel = String(explorerName ?? '').trim() || 'Explorer'
    return (
        <div
            className={`transaction-status transaction-status-${status}`}
            role="status"
            style={pending ? { position: 'relative', overflow: 'hidden' } : undefined}
        >
            {token && <TokenIcon token={token} size="button" />}
            {pending && <LoaderCircle className="status-spinner" aria-hidden="true" />}
            {status === 'sent' && <CheckCircle2 aria-hidden="true" />}
            {failed && <CircleX aria-hidden="true" />}
            <strong>{
                status === 'confirming' ? 'Confirm in wallet' :
                status === 'sending' ? 'Sending…' :
                status === 'submitted' ? 'Waiting for confirmation' :
                status === 'sent' ? 'Sent' :
                status === 'rejected' ? 'Rejected' : 'Failed'
            }</strong>
            {transactionUrl && (
                <a href={transactionUrl} target="_blank" rel="noreferrer">
                    View on {explorerLabel} <ExternalLink aria-hidden="true" />
                </a>
            )}
            {pending && (
                <motion.span
                    aria-hidden="true"
                    style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        width: '40%',
                        height: 3,
                        borderRadius: 999,
                        background: 'linear-gradient(90deg, transparent, currentColor 40%, currentColor 60%, transparent)',
                        opacity: 0.55,
                        pointerEvents: 'none',
                    }}
                    initial={reducedMotion ? { opacity: 0.35 } : { x: '-100%' }}
                    animate={reducedMotion ? { opacity: 0.35 } : { x: '350%' }}
                    transition={reducedMotion ? { duration: 0 } : {
                        duration: 1.1,
                        ease: 'easeInOut',
                        repeat: Infinity,
                    }}
                />
            )}
        </div>
    )
}
