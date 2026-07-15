import { CheckCircle2, CircleX, ExternalLink, LoaderCircle } from 'lucide-react'

export default function TransactionStatusDialog({ status, hash, explorerUrl }) {
    if (status === 'idle' || status === 'review') return null
    const pending = status === 'confirming' || status === 'sending' || status === 'submitted'
    const failed = status === 'failed' || status === 'rejected'
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
            {hash && (
                <a href={`${explorerUrl}/tx/${hash}`} target="_blank" rel="noreferrer">
                    View on BscScan <ExternalLink aria-hidden="true" />
                </a>
            )}
        </div>
    )
}
