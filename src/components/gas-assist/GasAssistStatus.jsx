const labels = {
    'checking-eligibility': 'Checking eligibility',
    'requesting-quote': 'Requesting sponsored approval',
    'waiting-signature': 'Waiting for signature',
    submitting: 'Submitting sponsored approval',
    submitted: 'Waiting for confirmation',
    confirmed: 'Approval confirmed',
    rejected: 'Signature rejected',
    'unsupported-wallet': 'Unsupported wallet',
    failed: 'Sponsored approval failed',
    'normal-approval': 'Waiting for normal approval',
    'normal-approval-submitted': 'Waiting for approval confirmation',
}

export default function GasAssistStatus({ state }) {
    const label = labels[state]
    return label ? <p className="gas-assist-status" role="status">{label}</p> : null
}
