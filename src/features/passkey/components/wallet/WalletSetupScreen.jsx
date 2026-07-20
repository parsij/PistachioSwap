/* oxlint-disable no-unused-vars -- shared setup declarations remain co-located with the existing screen contract. */
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


function ErrorNotice({ error, context, id = 'pistachio-wallet-error' }) {
    if (!error) return null
    return <p className="pistachio-wallet-error" id={id} role="alert">{safeErrorMessage(error, context)}</p>
}

function LoadingState({ title, children }) {
    return (
        <div className="pistachio-wallet-loading" role="status" aria-live="polite">
            <Loader2 className="pistachio-wallet-spinner" aria-hidden="true" />
            <strong>{title}</strong>
            {children && <p>{children}</p>}
        </div>
    )
}

function WalletRiskNotice({ compact = false }) {
    return (
        <div className={`pistachio-wallet-warning${compact ? ' compact' : ''}`}>
            <ShieldAlert aria-hidden="true" />
            <div>
                <strong>Self-custodial browser wallet</strong>
                <p>Pistachio Wallet is unaudited. A compromised browser, extension, or device can expose funds.</p>
                {!compact && <p>Your passkey unlocks encrypted wallet data. It is not your recovery phrase and does not make this a hardware wallet.</p>}
            </div>
        </div>
    )
}

function ScreenIntro({ title, children }) {
    return <div className="pistachio-wallet-intro"><h3>{title}</h3>{children && <p>{children}</p>}</div>
}

function BackButton({ onClick }) {
    return <button className="pistachio-wallet-back" type="button" onClick={onClick}><ArrowLeft aria-hidden="true" /> Back</button>
}

function EntryButton({ badge, children, description, disabled = false, icon: Icon, onClick, tone = 'default' }) {
    return (
        <button className={`pistachio-wallet-entry-button ${tone}`} type="button" disabled={disabled} onClick={onClick}>
            <span className="pistachio-wallet-entry-icon"><Icon aria-hidden="true" /></span>
            <span>
                <strong>{children}</strong>
                {description && <small>{description}</small>}
            </span>
            {badge ? <span className="pistachio-wallet-recommended">{badge}</span> : <ChevronRight className="pistachio-wallet-entry-arrow" aria-hidden="true" />}
        </button>
    )
}

function WalletEntryMenu({ onCreate, onImport, onRestore }) {
    return (
        <div className="pistachio-wallet-stack pistachio-wallet-home">
            <div className="pistachio-wallet-home-hero">
                <span className="pistachio-wallet-home-symbol" aria-hidden="true">
                    <KeyRound />
                </span>
                <span className="pistachio-wallet-eyebrow">Passkey-protected self-custody</span>
                <h3>Your wallet, secured by you.</h3>
                <p>Create a wallet or securely import one you already own.</p>
                <div className="pistachio-wallet-trust-row" aria-label="Wallet features">
                    <span><ShieldCheck aria-hidden="true" /> Local encryption</span>
                    <span><KeyRound aria-hidden="true" /> Passkey protected</span>
                    <span><WalletCards aria-hidden="true" /> 25 EVM networks</span>
                </div>
            </div>
            <EntryButton tone="primary" badge="Recommended" icon={WalletCards} description="Protected by a passkey" onClick={onCreate}>Create a new wallet</EntryButton>
            <div className="pistachio-wallet-entry-actions pistachio-wallet-secondary-actions">
                <EntryButton icon={FileKey} description="Use a recovery phrase, private key, or keystore file." onClick={onImport}>Import an existing wallet</EntryButton>
                <EntryButton icon={FileUp} description="Use an encrypted backup previously exported from Pistachio Wallet." onClick={onRestore}>Restore encrypted backup</EntryButton>
            </div>
            <WalletRiskNotice compact />
        </div>
    )
}

function ImportChooser({ flags, onBack, onSelect }) {
    const importAvailable = flags.walletImportEnabled || flags.keystoreImportEnabled
    return (
        <div className="pistachio-wallet-stack">
            <BackButton onClick={onBack} />
            <ScreenIntro title="Import an existing wallet">Choose what you already have. Your wallet information stays in this browser and is encrypted after import.</ScreenIntro>
            <div className="pistachio-wallet-entry-actions">
                {flags.walletImportEnabled && (
                    <>
                        <EntryButton icon={FileKey} description="Use a valid 12, 15, 18, 21, or 24-word phrase." onClick={() => onSelect('mnemonic')}>Recovery phrase</EntryButton>
                        <EntryButton icon={KeyRound} description="Use a 32-byte EVM private key." onClick={() => onSelect('private-key')}>Private key</EntryButton>
                    </>
                )}
                {flags.keystoreImportEnabled && <EntryButton icon={FileUp} description="Use an Ethereum Web3 Secret Storage V3 JSON file." onClick={() => onSelect('keystore')}>Keystore file</EntryButton>}
            </div>
            {!importAvailable && <p className="pistachio-wallet-note" role="status">Wallet import is not available in this environment.</p>}
        </div>
    )
}

const IMPORT_COPY = Object.freeze({
    mnemonic: {
        title: 'Import recovery phrase',
        description: 'Anyone with the phrase controls the wallet. PistachioSwap cannot recover it.',
    },
    'private-key': {
        title: 'Import private key',
        description: 'This wallet will not have a recovery phrase. Keep an independent encrypted backup.',
    },
    keystore: {
        title: 'Import keystore file',
        description: 'You will select a Web3 Secret Storage V3 file and enter its password after passkey setup.',
    },
})

function ImportRiskIntro({ busy, error, mode, onBack, onContinue }) {
    const copy = IMPORT_COPY[mode]
    const [acknowledged, setAcknowledged] = useState(false)
    return (
        <div className="pistachio-wallet-stack">
            <BackButton onClick={onBack} />
            <ScreenIntro title={copy.title}>{copy.description}</ScreenIntro>
            <WalletRiskNotice />
            {mode === 'mnemonic' && <p className="pistachio-wallet-note">BIP-39 passphrases are not supported. Import only a standard recovery phrase with no extra passphrase.</p>}
            <label className="pistachio-wallet-check"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I understand that anyone with this wallet secret can control its funds.</label>
            <button className="pistachio-wallet-primary" type="button" disabled={busy || !acknowledged} onClick={onContinue}>
                <KeyRound aria-hidden="true" /> {busy ? 'Creating passkey…' : 'Create passkey and continue'}
            </button>
            <ErrorNotice error={error} />
        </div>
    )
}

function RestoreBackupContent({ onBack, onRestored }) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const [fileName, setFileName] = useState('')

    async function restoreEncryptedBackup(file) {
        if (!file || busy) return
        setBusy(true)
        setError(null)
        setFileName(file.name ?? '')
        try {
            const vault = await manager.restoreEncryptedBackup(await file.text())
            await onRestored?.(vault)
        } catch (nextError) {
            setError(nextError)
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="pistachio-wallet-stack">
            <BackButton onClick={onBack} />
            <ScreenIntro title="Restore encrypted backup">Select a Pistachio Wallet backup exported from another browser session.</ScreenIntro>
            <label
                className="pistachio-wallet-dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); void restoreEncryptedBackup(event.dataTransfer.files?.[0]) }}
            >
                {busy ? <Loader2 className="pistachio-wallet-spinner" aria-hidden="true" /> : <FileUp aria-hidden="true" />}
                <strong>{busy ? 'Checking encrypted backup…' : fileName || 'Choose or drop encrypted backup'}</strong>
                <span>{fileName && !busy ? 'Choose this file again or select another file' : 'JSON files up to 1 MiB'}</span>
                <input aria-label="Choose encrypted backup file" type="file" accept="application/json,.json" disabled={busy} onChange={(event) => { void restoreEncryptedBackup(event.target.files?.[0]); event.target.value = '' }} />
            </label>
            <div className="pistachio-wallet-info"><ShieldCheck aria-hidden="true" /><p>The backup remains encrypted. Unlock requires its matching passkey and the same PistachioSwap domain. A synced passkey does not automatically sync this backup.</p></div>
            <ErrorNotice error={error} context="restore" />
        </div>
    )
}

function shortenAddress(address) {
    return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function sourceTypeLabel(sourceType) {
    return {
        'generated-mnemonic': 'Created recovery phrase',
        'imported-mnemonic': 'Imported recovery phrase',
        'imported-private-key': 'Imported private key',
        'imported-keystore': 'Imported keystore',
    }[sourceType] ?? 'Saved wallet'
}

function formatLastUsed(value) {
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) return 'Not available'
    const date = new Date(parsed)
    const today = new Date()
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    const dayDifference = Math.round((startOfToday - startOfDate) / 86_400_000)
    if (dayDifference === 0) return 'Today'
    if (dayDifference === 1) return 'Yesterday'
    return LAST_USED_DATE_FORMATTER.format(date)
}



export { ErrorNotice, LoadingState, WalletEntryMenu, ImportChooser, ImportRiskIntro, RestoreBackupContent, IMPORT_COPY }
