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
import { ErrorNotice } from './WalletPrimitives.jsx'

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


function StorageErrorContent({ snapshot }) {
    const [busy, setBusy] = useState(false)
    async function retry() {
        if (busy) return
        setBusy(true)
        try {
            await manager.retryInitialization()
        } finally {
            setBusy(false)
        }
    }
    return (
        <div className="pistachio-wallet-stack">
            <div className="pistachio-wallet-danger"><AlertTriangle aria-hidden="true" /><div><h3>Encrypted storage unavailable</h3><p>Pistachio Wallet cannot continue until this browser can safely access IndexedDB.</p></div></div>
            <button className="pistachio-wallet-primary" type="button" disabled={busy} onClick={retry}>{busy ? 'Checking storage…' : 'Try again'}</button>
            <ErrorNotice error={snapshot.error} />
        </div>
    )
}

function LockedSessionScreen({ snapshot }) {
    const [disconnectConfirmation, setDisconnectConfirmation] = useState(false)
    const [disconnecting, setDisconnecting] = useState(false)
    const [error, setError] = useState(null)
    const [requestingUnlock, setRequestingUnlock] = useState(false)
    const unlockRequestRef = useRef(false)
    const unlockButtonRef = useRef(null)
    const unlocking = requestingUnlock || snapshot.phase === 'unlocking'

    useEffect(() => {
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = previousOverflow
        }
    }, [])

    async function unlockWallet() {
        if (unlockRequestRef.current || snapshot.phase === 'unlocking') return
        unlockRequestRef.current = true
        setRequestingUnlock(true)
        setError(null)
        try {
            await manager.unlock()
        } catch (nextError) {
            setError(nextError)
        } finally {
            unlockRequestRef.current = false
            setRequestingUnlock(false)
        }
    }

    async function openRecoveryOptions() {
        await manager.disconnect()
        manager.open('wallet')
    }

    async function disconnectWallet() {
        if (disconnecting) return
        setDisconnecting(true)
        setError(null)
        try {
            await manager.disconnect()
        } catch (nextError) {
            setError(nextError)
            setDisconnecting(false)
        }
    }

    const displayedError = error ?? snapshot.error
    const recoveryAvailable = displayedError?.code === 'PISTACHIO_PASSKEY_NOT_AVAILABLE'

    return (
        <Dialog.Root open>
            <Dialog.Portal>
                <Dialog.Overlay className="pistachio-session-lock-overlay" />
                <Dialog.Content
                    className="pistachio-session-lock-dialog"
                    aria-describedby="pistachio-session-lock-description"
                    onEscapeKeyDown={(event) => event.preventDefault()}
                    onOpenAutoFocus={(event) => { event.preventDefault(); unlockButtonRef.current?.focus() }}
                    onPointerDownOutside={(event) => event.preventDefault()}
                >
                    <button className="pistachio-session-disconnect-button" type="button" disabled={unlocking || disconnecting} onClick={() => setDisconnectConfirmation(true)}>Disconnect wallet</button>
                    <span className="pistachio-session-lock-icon"><Lock aria-hidden="true" /></span>
                    <Dialog.Title>Pistachio Wallet is locked</Dialog.Title>
                    <Dialog.Description id="pistachio-session-lock-description">Verify your passkey to continue using your wallet.</Dialog.Description>
                    <button ref={unlockButtonRef} className="pistachio-session-unlock-button" type="button" disabled={unlocking} onClick={unlockWallet}>
                        {unlocking ? <Loader2 className="pistachio-wallet-spinner" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
                        {unlocking ? 'Waiting for passkey…' : 'Unlock wallet'}
                    </button>
                    <ErrorNotice error={displayedError} id="pistachio-session-lock-error" />
                    {recoveryAvailable && <button className="pistachio-session-recovery-button" type="button" disabled={unlocking} onClick={openRecoveryOptions}>Open recovery options</button>}
                </Dialog.Content>
                <Dialog.Root open={disconnectConfirmation} onOpenChange={setDisconnectConfirmation}>
                    <Dialog.Portal>
                        <Dialog.Overlay className="pistachio-session-disconnect-overlay" />
                        <Dialog.Content className="pistachio-session-disconnect-confirmation" onPointerDownOutside={(event) => event.preventDefault()}>
                            <Dialog.Title>Disconnect Pistachio Wallet?</Dialog.Title>
                            <Dialog.Description>Are you sure you want to disconnect? This locks the wallet and returns to the normal connect screen. Your encrypted wallet stays saved in this browser.</Dialog.Description>
                            <div>
                                <button type="button" disabled={disconnecting} onClick={() => setDisconnectConfirmation(false)}>Cancel</button>
                                <button className="pistachio-session-confirm-disconnect" type="button" disabled={disconnecting} onClick={disconnectWallet}>{disconnecting ? 'Disconnecting…' : 'Disconnect'}</button>
                            </div>
                        </Dialog.Content>
                    </Dialog.Portal>
                </Dialog.Root>
            </Dialog.Portal>
        </Dialog.Root>
    )
}



function ExitConfirmation({ phase, onCancel, onConfirm }) {
    const passkeyOnly = phase === 'passkey-ready'
    const revealedSecret = phase === 'unlocked'
    return (
        <div className="pistachio-wallet-stack">
            <div className="pistachio-wallet-warning"><AlertTriangle aria-hidden="true" /><div><strong>Leave this wallet flow?</strong><p>{revealedSecret ? 'Sensitive information will be hidden before the wallet window closes.' : passkeyOnly ? 'No wallet secret has been generated, but the new passkey may remain in your browser or password manager.' : 'Unsaved wallet setup information will be cleared. Make sure you have recorded any recovery information shown on this screen.'}</p></div></div>
            <div className="pistachio-wallet-button-row"><button className="pistachio-wallet-primary" type="button" onClick={onCancel}>Continue setup</button><button type="button" onClick={onConfirm}>Leave setup</button></div>
        </div>
    )
}


export { StorageErrorContent, LockedSessionScreen, ExitConfirmation }
