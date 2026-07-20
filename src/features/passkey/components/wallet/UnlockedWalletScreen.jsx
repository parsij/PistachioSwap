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
import { ErrorNotice, ScreenIntro, shortenAddress, formatLastUsed } from './WalletPrimitives.jsx'

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


function UnlockedContent({ onSensitiveChange, snapshot }) {
    const [busyAction, setBusyAction] = useState(null)
    const [error, setError] = useState(null)
    const secretRef = useRef(null)
    const [secretKind, setSecretKind] = useState(null)
    const [newLabel, setNewLabel] = useState('Backup passkey')
    const [labels, setLabels] = useState(() => Object.fromEntries(snapshot.vault.keyWraps.map((wrap) => [wrap.id, wrap.label])))
    const [keystoreBackupPassword, setKeystoreBackupPassword] = useState('')
    const [keystoreBackupConfirmation, setKeystoreBackupConfirmation] = useState('')
    const clearTimer = useRef(null)

    useEffect(() => {
        onSensitiveChange(Boolean(busyAction || secretKind))
        return () => onSensitiveChange(false)
    }, [busyAction, onSensitiveChange, secretKind])

    useEffect(() => () => {
        if (clearTimer.current) clearTimeout(clearTimer.current)
        secretRef.current = null
    }, [])

    async function run(name, action) {
        if (busyAction) return null
        setBusyAction(name)
        setError(null)
        try {
            return await action()
        } catch (nextError) {
            setError(nextError)
            return null
        } finally {
            setBusyAction(null)
        }
    }

    function hideSecret() {
        if (clearTimer.current) clearTimeout(clearTimer.current)
        clearTimer.current = null
        secretRef.current = null
        setSecretKind(null)
    }

    function showSecret(value, kind) {
        hideSecret()
        secretRef.current = value
        setSecretKind(kind)
        clearTimer.current = setTimeout(hideSecret, 60_000)
    }

    async function exportKeystoreBackup() {
        if (keystoreBackupPassword !== keystoreBackupConfirmation) {
            setError(new Error('Keystore backup passwords do not match.'))
            return
        }
        const keystore = await run('keystore-export', () => manager.exportKeystore(keystoreBackupPassword))
        setKeystoreBackupPassword('')
        setKeystoreBackupConfirmation('')
        if (keystore) saveTextFile('pistachio-wallet-v3-keystore.json', keystore)
    }

    return (
        <div className="pistachio-wallet-stack">
            <div className="pistachio-wallet-unlocked-heading">
                <div className="pistachio-wallet-success" role="status"><Check aria-hidden="true" /> Wallet unlocked</div>
                <code>{shortenAddress(snapshot.address)}</code>
            </div>
            <section className="pistachio-wallet-section">
                <ScreenIntro title="Passkeys">Manage passkeys that can unlock this encrypted wallet.</ScreenIntro>
                {snapshot.vault.keyWraps.map((wrap, index) => (
                    <div className="pistachio-passkey-row" key={wrap.id}>
                        <div>
                            <div className="pistachio-passkey-label"><label className="pistachio-sr-only" htmlFor={`passkey-${wrap.id}`}>Passkey label</label><input id={`passkey-${wrap.id}`} value={labels[wrap.id] ?? wrap.label} maxLength={80} onChange={(event) => setLabels((current) => ({ ...current, [wrap.id]: event.target.value }))} /><button type="button" aria-label={`Save label for ${wrap.label}`} disabled={Boolean(busyAction)} onClick={() => run(`rename-${wrap.id}`, () => manager.renamePasskey(wrap.id, labels[wrap.id]))}><Check aria-hidden="true" /></button></div>
                            <span>{index === 0 ? 'Primary passkey' : 'Backup passkey'} · Verified for wallet encryption</span>
                            <span>{wrap.rpId} · Added {formatLastUsed(wrap.createdAt)}</span>
                            <span>{wrap.credentialTransports.join(', ') || 'Transport not reported'} · Last used {snapshot.lastUnlockByWrap[wrap.id] ? new Date(snapshot.lastUnlockByWrap[wrap.id]).toLocaleString() : 'Never'}</span>
                        </div>
                        <button className="pistachio-wallet-icon-danger" type="button" aria-label={`Remove ${wrap.label}`} disabled={Boolean(busyAction) || snapshot.vault.keyWraps.length === 1 || !snapshot.recoveryBackupConfirmed} onClick={() => run(`remove-${wrap.id}`, () => manager.removePasskey(wrap.id))}><Trash2 aria-hidden="true" /></button>
                    </div>
                ))}
                <label htmlFor="pistachio-new-passkey-label">New passkey label</label>
                <div className="pistachio-wallet-inline"><input id="pistachio-new-passkey-label" value={newLabel} maxLength={80} onChange={(event) => setNewLabel(event.target.value)} /><button type="button" disabled={Boolean(busyAction) || !newLabel.trim()} onClick={() => run('add-passkey', () => manager.addBackupPasskey(newLabel))}><Plus aria-hidden="true" /> Add backup passkey</button></div>
                <button type="button" disabled={Boolean(busyAction)} onClick={() => run('test-passkey', () => manager.reauthenticate())}><KeyRound aria-hidden="true" /> Test passkey unlock</button>
                {!snapshot.recoveryBackupConfirmed && <label className="pistachio-wallet-check"><input type="checkbox" disabled={Boolean(busyAction)} onChange={(event) => event.target.checked && run('confirm-backup', () => manager.confirmRecoveryBackup())} /> I have an offline wallet recovery backup.</label>}
                <p className="pistachio-wallet-note">Removing access here does not delete the passkey from Chrome, your operating system, or a password manager.</p>
            </section>
            <section className="pistachio-wallet-section">
                <ScreenIntro title="Recovery and backups">Reauthentication is required before exporting or revealing sensitive information.</ScreenIntro>
                <button type="button" disabled={Boolean(busyAction)} onClick={() => run('backup-export', async () => saveTextFile('pistachio-wallet-backup.json', await manager.exportEncryptedBackup()))}><Download aria-hidden="true" /> Export encrypted backup</button>
                {snapshot.vault.sourceType.endsWith('mnemonic') ? (
                    <button type="button" disabled={Boolean(busyAction)} onClick={() => run('reveal-phrase', async () => showSecret(await manager.revealRecoveryPhrase(), 'Recovery phrase'))}>Reveal recovery phrase</button>
                ) : (
                    <button type="button" disabled={Boolean(busyAction)} onClick={() => run('reveal-key', async () => showSecret(await manager.revealPrivateKey(), 'Private key'))}>Reveal private key</button>
                )}
                {!snapshot.vault.sourceType.endsWith('mnemonic') && (
                    <div className="pistachio-keystore-export">
                        <label htmlFor="pistachio-backup-password">Encrypted keystore password</label>
                        <input id="pistachio-backup-password" type="password" value={keystoreBackupPassword} autoComplete="new-password" onChange={(event) => setKeystoreBackupPassword(event.target.value)} />
                        <label htmlFor="pistachio-backup-password-confirmation">Confirm password</label>
                        <input id="pistachio-backup-password-confirmation" type="password" value={keystoreBackupConfirmation} autoComplete="new-password" onChange={(event) => setKeystoreBackupConfirmation(event.target.value)} />
                        <button type="button" disabled={Boolean(busyAction) || keystoreBackupPassword.length < 12 || !keystoreBackupConfirmation} onClick={exportKeystoreBackup}><Download aria-hidden="true" /> Export encrypted keystore</button>
                    </div>
                )}
                {secretKind && (
                    <div className="pistachio-secret-reveal" role="region" aria-label={secretKind}>
                        <div><strong>{secretKind}</strong><span>Hidden automatically after 60 seconds</span></div>
                        <code>{secretRef.current}</code>
                        <button type="button" onClick={hideSecret}>Hide</button>
                    </div>
                )}
                <p className="pistachio-wallet-note">A passkey may sync while this browser’s encrypted wallet data does not. Test every backup before relying on it.</p>
            </section>
            <button type="button" disabled={Boolean(busyAction)} onClick={() => manager.lock('manual')}><Lock aria-hidden="true" /> Lock wallet</button>
            {busyAction && <p className="pistachio-wallet-progress" role="status" aria-live="polite"><Loader2 className="pistachio-wallet-spinner" aria-hidden="true" /> Complete the requested wallet check…</p>}
            <ErrorNotice error={error} />
        </div>
    )
}


export { UnlockedContent }
