/* oxlint-disable no-unused-vars -- shared declarations preserve the extracted screen contract. */
import * as Dialog from '@radix-ui/react-dialog'
import {
    AlertTriangle,
    ArrowLeft,
    Check,
    ChevronRight,
    Copy,
    Download,
    FileKey,
    FileUp,
    KeyRound,
    Loader2,
    Lock,
    Pencil,
    Plus,
    ShieldAlert,
    ShieldCheck,
    Trash2,
    WalletCards, WalletIcon,
    X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import '@fontsource/ubuntu/latin-400.css'
import '@fontsource/ubuntu/latin-500.css'
import '@fontsource/ubuntu/latin-700.css'
import { walletUIOperations as manager } from '../../services/walletUIOperations.js'
import { ErrorNotice, shortenAddress } from './WalletPrimitives.jsx'

const GUARDED_SETUP_PHASES = new Set(['passkey-ready', 'confirm-recovery', 'confirm-import', 'onboarding-ready'])
const LAST_USED_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
})

const SAFE_ERROR_COPY = Object.freeze({
    PISTACHIO_CONNECTION_CANCELLED: 'The wallet request was canceled. You can try again when you are ready.',
    PISTACHIO_PASSKEY_IFRAME_BLOCKED: 'Open PistachioSwap in a top-level browser tab to use Pistachio Wallet.',
    PISTACHIO_PASSKEY_INSECURE_CONTEXT: 'Pistachio Wallet requires a secure browser connection.',
    PISTACHIO_PASSKEY_NOT_AVAILABLE: 'The passkey request was canceled or the matching passkey is unavailable.',
    PISTACHIO_PASSKEY_PRF_RESULT_MISSING: 'This passkey did not provide the protection required by Pistachio Wallet.',
    PISTACHIO_PASSKEY_PRF_UNSUPPORTED: 'This browser or passkey provider cannot protect Pistachio Wallet.',
    PISTACHIO_VAULT_ALREADY_EXISTS: 'This encrypted backup is already saved in this browser.',
    PISTACHIO_VAULT_NOT_FOUND: 'That saved Pistachio Wallet is no longer available.',
    PISTACHIO_WALLET_STORAGE_FAILED: 'Pistachio Wallet could not safely access encrypted browser storage.',
    PISTACHIO_WALLET_UNLOCK_FAILED: 'Pistachio Wallet could not be unlocked. Check that you selected the correct passkey.',
})

function chooseWordPositions() {
    const positions = new Set()
    while (positions.size < 3) positions.add(crypto.getRandomValues(new Uint8Array(1))[0] % 12)
    return [...positions].sort((left, right) => left - right)
}

function saveTextFile(name, text, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type }))
    const anchor = document.createElement('a')
    try {
        anchor.href = url
        anchor.download = name
        anchor.click()
    } finally {
        anchor.remove()
        URL.revokeObjectURL(url)
    }
}

function safeErrorMessage(error, context = 'wallet') {
    if (!error) return ''
    if (SAFE_ERROR_COPY[error.code]) return SAFE_ERROR_COPY[error.code]
    const message = String(error.message ?? '')
    if (/recovery phrase has invalid words or checksum/iu.test(message)) {
        return 'The recovery phrase has an invalid word or checksum. Check every word and try again.'
    }
    if (/private key must be exactly 32 bytes/iu.test(message)) {
        return 'Enter a private key containing exactly 64 hexadecimal characters, with or without 0x.'
    }
    if (/keystore exceeds 1 MiB/iu.test(message)) return 'The keystore file is larger than the 1 MiB limit.'
    if (/keystore is not valid JSON/iu.test(message)) return 'The selected keystore is not valid JSON.'
    if (/only Web3 Secret Storage V3/iu.test(message)) return 'Select an Ethereum Web3 Secret Storage V3 keystore file.'
    if (context === 'keystore') return 'The keystore could not be opened. Check the file and password, then try again.'
    if (context === 'restore') return 'This file is not a valid encrypted Pistachio Wallet backup.'
    if (/wallet name is required/iu.test(message)) return 'Enter a name for this saved wallet.'
    if (/passwords do not match/iu.test(message)) return 'The passwords do not match.'
    if (/password must be at least 12 characters/iu.test(message)) return 'Use a backup password with at least 12 characters.'
    return 'Pistachio Wallet could not complete that action. Try again.'
}


function ReviewValue({ children }) {
    if (children === null || children === undefined || children === '') return <span>Not provided</span>
    if (typeof children === 'object') return <pre>{JSON.stringify(children, null, 2)}</pre>
    return <span>{String(children)}</span>
}

function SigningReviewDialog() {
    const [request, setRequest] = useState(null)
    const [submitted, setSubmitted] = useState(false)
    useEffect(() => manager.reviewQueue.subscribe((nextRequest) => {
        setSubmitted(false)
        setRequest(nextRequest)
    }), [])

    const payload = request?.payload ?? {}
    const calldata = String(payload.calldata ?? '')
    const hasCalldata = calldata && calldata !== '0x'
    const hasUnknownCalldata = hasCalldata && payload.calldataKnown !== true

    function approve() {
        if (!request || submitted) return
        setSubmitted(true)
        manager.reviewQueue.approve(request.id)
    }

    function reject() {
        if (!request || submitted) return
        setSubmitted(true)
        manager.reviewQueue.reject(request.id)
    }

    return (
        <Dialog.Root open={Boolean(request)}>
            <Dialog.Portal>
                <Dialog.Overlay className="pistachio-wallet-overlay pistachio-signing-overlay" />
                <Dialog.Content
                    className="pistachio-wallet-dialog pistachio-signing-review"
                    aria-describedby="pistachio-signing-description"
                    onKeyDownCapture={() => void manager.recordActivity()}
                    onPointerDownCapture={() => void manager.recordActivity()}
                    onEscapeKeyDown={(event) => event.preventDefault()}
                    onPointerDownOutside={(event) => event.preventDefault()}
                >
                    <header><div><span>Review required</span><Dialog.Title>{request?.action ?? 'Signing review'}</Dialog.Title></div><button type="button" aria-label="Reject signing request" onClick={reject}><X aria-hidden="true" /></button></header>
                    {request && (
                        <div className="pistachio-wallet-review-body">
                            <p id="pistachio-signing-description">Check every detail before approving. Pistachio Wallet will sign only after your confirmation.</p>
                            <dl className="pistachio-wallet-review-list">
                                <div><dt>Wallet</dt><dd>{shortenAddress(request.walletAddress)}</dd></div>
                                <div><dt>Network</dt><dd>{request.chainName} ({request.chainId})</dd></div>
                                <div><dt>Origin</dt><dd>{request.origin}</dd></div>
                                {payload.actionType && <div><dt>Action</dt><dd><ReviewValue>{payload.actionType}</ReviewValue></dd></div>}
                                {payload.completeMessage !== undefined && <div className="full"><dt>Complete message</dt><dd><ReviewValue>{payload.completeMessage}</ReviewValue></dd></div>}
                                {payload.purpose && <div><dt>Purpose</dt><dd><ReviewValue>{payload.purpose}</ReviewValue></dd></div>}
                                {payload.domain && <div className="full"><dt>Domain</dt><dd><ReviewValue>{payload.domain}</ReviewValue></dd></div>}
                                {payload.primaryType && <div><dt>Primary type</dt><dd><ReviewValue>{payload.primaryType}</ReviewValue></dd></div>}
                                {payload.verifyingContract && <div><dt>Verifying contract</dt><dd><ReviewValue>{payload.verifyingContract}</ReviewValue></dd></div>}
                                {payload.fields && <div className="full"><dt>Fields</dt><dd><ReviewValue>{payload.fields}</ReviewValue></dd></div>}
                                {payload.destination && <div><dt>Destination</dt><dd><ReviewValue>{payload.destination}</ReviewValue></dd></div>}
                                {payload.token && <div><dt>Token contract</dt><dd><ReviewValue>{payload.token}</ReviewValue></dd></div>}
                                {payload.recipient && <div><dt>Recipient</dt><dd><ReviewValue>{payload.recipient}</ReviewValue></dd></div>}
                                {payload.spender && <div><dt>Spender</dt><dd><ReviewValue>{payload.spender}</ReviewValue></dd></div>}
                                {payload.amount !== null && payload.amount !== undefined && <div><dt>Amount (raw units)</dt><dd><ReviewValue>{payload.amount}</ReviewValue></dd></div>}
                                {payload.value !== undefined && <div><dt>Value (wei)</dt><dd><ReviewValue>{payload.value}</ReviewValue></dd></div>}
                                {payload.gasLimit && <div><dt>Gas limit</dt><dd><ReviewValue>{payload.gasLimit}</ReviewValue></dd></div>}
                                {payload.gasPrice !== undefined && <div><dt>Gas price</dt><dd><ReviewValue>{payload.gasPrice}</ReviewValue></dd></div>}
                                {hasCalldata && <div className="full"><dt>Transaction data</dt><dd><ReviewValue>{calldata}</ReviewValue></dd></div>}
                            </dl>
                            {payload.unlimitedWarning && <div className="pistachio-wallet-danger"><AlertTriangle aria-hidden="true" /><p>This request appears to grant an unlimited token approval.</p></div>}
                            {hasUnknownCalldata && <div className="pistachio-wallet-warning"><ShieldAlert aria-hidden="true" /><p>This request contains contract data. Verify the destination and full transaction data before approving.</p></div>}
                            {payload.submission && <div className="pistachio-wallet-info"><ShieldCheck aria-hidden="true" /><p>{payload.submission}</p></div>}
                            <p className="pistachio-wallet-review-expiry">Request expires at {new Date(request.expiresAt).toLocaleTimeString()}.</p>
                            <div className="pistachio-wallet-button-row pistachio-wallet-review-actions"><button type="button" disabled={submitted} onClick={reject}>Reject</button><button className="pistachio-wallet-primary" type="button" disabled={submitted} onClick={approve}>{submitted ? 'Processing…' : 'Approve'}</button></div>
                        </div>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}


export { ReviewValue, SigningReviewDialog }
