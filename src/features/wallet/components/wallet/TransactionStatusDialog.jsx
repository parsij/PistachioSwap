import { CheckCircle2, CircleX, ExternalLink, LoaderCircle } from 'lucide-react'

/** Returns the multichain Blockscan URL for an EVM transaction hash. */
export function blockscanTransactionUrl(hash) {
    const normalized = String(hash ?? '').trim()
    return normalized ? `https://blockscan.com/tx/${normalized}` : null
}

/** Presents wallet transfer pending/success/failure status and optional explorer link. */
export default function TransactionStatusDialog({ status, hash }) {
    if (status === 'idle' || status === 'review') return null
    const pending = status === 'confirming' || status === 'sending' || status === 'submitted'
    const failed = status === 'failed' || status === 'rejected'
    const transactionUrl = blockscanTransactionUrl(hash)
    return (
        <div className={`transaction-status transaction-status-${status}`} role="status">
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
                    View on Blockscan <ExternalLink aria-hidden="true" />
                </a>
            )}
        </div>
    )
}
