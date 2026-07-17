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
import { createPortal } from 'react-dom'

import { getPistachioWalletManager } from '../../wallet/pistachio/walletManager.js'
import './pistachioWallet.css'
import PistachioLogo from '../../../public/icons/PistachioLogo.svg'

const manager = getPistachioWalletManager()
const CRITICAL_PHASES = new Set(['registering-passkey', 'unlocking', 'persisting'])
const GUARDED_SETUP_PHASES = new Set(['passkey-ready', 'confirm-recovery', 'confirm-import', 'onboarding-ready'])

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
            <Icon aria-hidden="true" />
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
                <span className="pistachio-wallet-home-orb" aria-hidden="true">
                    <KeyRound />
                </span>
                <span className="pistachio-wallet-eyebrow">Passkey-powered self custody</span>
                <h3>One wallet. Every supported network.</h3>
                <p>Create a new wallet or bring an existing wallet to PistachioSwap.</p>
                <div className="pistachio-wallet-trust-row" aria-label="Wallet features">
                    <span><ShieldCheck aria-hidden="true" /> Local encryption</span>
                    <span><KeyRound aria-hidden="true" /> Passkey protected</span>
                    <span><WalletCards aria-hidden="true" /> 25 EVM networks</span>
                </div>
            </div>
            <div className="pistachio-wallet-entry-actions">
                <EntryButton badge="Recommended" icon={WalletCards} description="Create a new wallet protected by a passkey." onClick={onCreate}>Create a new wallet</EntryButton>
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
    return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString() : 'Not available'
}

function WalletIdentity({ selected = false, vault }) {
    return (
        <div className="pistachio-wallet-identity">
            <span className="pistachio-wallet-identity-icon"><WalletIcon aria-hidden="true" /></span>
            <div>
                <strong>{vault.name}</strong>
                <code>{shortenAddress(vault.address)}</code>
                <span>{sourceTypeLabel(vault.sourceType)} · Last used {formatLastUsed(vault.lastUsedAt ?? vault.updatedAt)}</span>
            </div>
            {selected && <span className="pistachio-wallet-selected"><Check aria-hidden="true" /> Selected</span>}
        </div>
    )
}

function DeleteLocalVaultConfirmation({ onCancel, onDeleted, onSensitiveChange, vault }) {
    const [confirmation, setConfirmation] = useState('')
    const [backupAcknowledged, setBackupAcknowledged] = useState(false)
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        onSensitiveChange?.(true)
        return () => onSensitiveChange?.(false)
    }, [onSensitiveChange])

    async function removeLocalVault() {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
            await manager.deleteLocalVault(vault.vaultId, { backupAcknowledged, confirmation })
            onDeleted()
        } catch (nextError) {
            setError(nextError)
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="pistachio-wallet-stack">
            <BackButton onClick={onCancel} />
            <div className="pistachio-wallet-danger">
                <AlertTriangle aria-hidden="true" />
                <div>
                    <h3>Remove wallet from this browser</h3>
                    <p>This removes only the encrypted local copy. It does not delete the wallet or funds on any network.</p>
                </div>
            </div>
            <div className="pistachio-wallet-field-group"><span>Wallet address</span><code className="pistachio-wallet-address">{vault.address}</code></div>
            <label className="pistachio-wallet-check"><input type="checkbox" checked={backupAcknowledged} onChange={(event) => setBackupAcknowledged(event.target.checked)} /> I have the recovery phrase or a tested backup for this wallet.</label>
            <label htmlFor="pistachio-delete-confirmation">Type DELETE to confirm</label>
            <input id="pistachio-delete-confirmation" value={confirmation} autoComplete="off" spellCheck="false" aria-describedby="pistachio-delete-help" onChange={(event) => setConfirmation(event.target.value)} />
            <p className="pistachio-wallet-note" id="pistachio-delete-help">This action cannot remove a passkey from your browser or password manager.</p>
            <div className="pistachio-wallet-button-row">
                <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
                <button className="pistachio-wallet-danger-button" type="button" disabled={busy || !backupAcknowledged || confirmation !== 'DELETE'} onClick={removeLocalVault}><Trash2 aria-hidden="true" /> {busy ? 'Removing…' : 'Remove from this browser'}</button>
            </div>
            <ErrorNotice error={error} />
        </div>
    )
}

function AnotherWalletMenu({ flags, onBack, onRestore, onStart }) {
    return (
        <div className="pistachio-wallet-stack">
            <BackButton onClick={onBack} />
            <ScreenIntro title="Create or import another wallet">Your previously saved encrypted wallets will remain in this browser.</ScreenIntro>
            <div className="pistachio-wallet-entry-actions">
                <EntryButton icon={WalletCards} onClick={() => onStart(null)}>Create a new wallet</EntryButton>
                {flags.walletImportEnabled && (
                    <>
                        <EntryButton icon={FileKey} onClick={() => onStart('mnemonic')}>Import recovery phrase</EntryButton>
                        <EntryButton icon={KeyRound} onClick={() => onStart('private-key')}>Import private key</EntryButton>
                    </>
                )}
                {flags.keystoreImportEnabled && <EntryButton icon={FileUp} onClick={() => onStart('keystore')}>Import keystore file</EntryButton>}
                <EntryButton icon={FileUp} onClick={onRestore}>Restore encrypted backup</EntryButton>
            </div>
        </div>
    )
}

function InaccessibleWalletContent({ onRestore, onSensitiveChange, onStart, snapshot }) {
    const [deleteTarget, setDeleteTarget] = useState(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const vault = snapshot.vault

    async function tryAgain() {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
            await manager.unlock()
        } catch (nextError) {
            setError(nextError)
        } finally {
            setBusy(false)
        }
    }

    if (deleteTarget) {
        return <DeleteLocalVaultConfirmation vault={deleteTarget} onSensitiveChange={onSensitiveChange} onCancel={() => setDeleteTarget(null)} onDeleted={() => setDeleteTarget(null)} />
    }
    return (
        <div className="pistachio-wallet-stack">
            <div className="pistachio-wallet-warning"><ShieldAlert aria-hidden="true" /><div><strong>Passkey unavailable</strong><p>This wallet is saved in this browser, but its passkey is unavailable.</p></div></div>
            <WalletIdentity selected vault={{ ...vault, lastUsedAt: vault.updatedAt }} />
            <button className="pistachio-wallet-primary" type="button" disabled={busy} onClick={tryAgain}><KeyRound aria-hidden="true" /> {busy ? 'Requesting passkey…' : 'Try again'}</button>
            <div className="pistachio-wallet-entry-actions">
                {snapshot.flags.walletImportEnabled && <EntryButton icon={FileKey} onClick={() => onStart('mnemonic')}>Restore using recovery phrase</EntryButton>}
                <EntryButton icon={FileUp} onClick={onRestore}>Restore encrypted backup</EntryButton>
                {snapshot.flags.walletImportEnabled && <EntryButton icon={KeyRound} onClick={() => onStart('private-key')}>Import private key</EntryButton>}
                <EntryButton icon={Trash2} tone="secondary-danger" onClick={() => setDeleteTarget(vault)}>Remove inaccessible wallet from this browser</EntryButton>
            </div>
            <p className="pistachio-wallet-note">Removing the encrypted local copy does not remove funds or delete the wallet on any network.</p>
            <ErrorNotice error={error} />
        </div>
    )
}

function SavedWalletEntry({ onAnother, onChoose, onRestore, onSensitiveChange, onStart, snapshot }) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    async function unlockPreviousWallet() {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
            await manager.unlock()
        } catch (nextError) {
            setError(nextError)
        } finally {
            setBusy(false)
        }
    }

    if (snapshot.error?.code === 'PISTACHIO_PASSKEY_NOT_AVAILABLE') {
        return <InaccessibleWalletContent snapshot={snapshot} onRestore={onRestore} onSensitiveChange={onSensitiveChange} onStart={onStart} />
    }

    return (
        <div className="pistachio-wallet-stack">
            <ScreenIntro title="Previous Pistachio Wallet detected">Unlock a saved wallet or create and import another wallet.</ScreenIntro>
            <WalletIdentity selected vault={{
                ...snapshot.vault,
                lastUsedAt: snapshot.vaults.find((candidate) => candidate.vaultId === snapshot.vault.vaultId)?.lastUsedAt,
                name: snapshot.vaults.find((candidate) => candidate.vaultId === snapshot.vault.vaultId)?.name ?? snapshot.vault.name,
            }} />
            <div className="pistachio-wallet-entry-actions">
                <EntryButton icon={KeyRound} description="Unlock this wallet with its existing passkey." disabled={busy} onClick={unlockPreviousWallet}>{busy ? 'Requesting passkey…' : 'Use previous wallet'}</EntryButton>
                {snapshot.vaults.length > 1 && <EntryButton icon={WalletCards} description={`${snapshot.vaults.length} encrypted wallets are saved in this browser.`} onClick={onChoose}>Choose another saved wallet</EntryButton>}
                <EntryButton icon={Plus} description="Your saved wallets will not be overwritten." onClick={onAnother}>Create or import another wallet</EntryButton>
            </div>
            <ErrorNotice error={error ?? snapshot.error} />
        </div>
    )
}

function SavedWalletChooser({ onBack, onRestore, onSensitiveChange, onStart, snapshot }) {
    const [busyVaultId, setBusyVaultId] = useState(null)
    const [deleteTarget, setDeleteTarget] = useState(null)
    const [error, setError] = useState(null)
    const [renameTarget, setRenameTarget] = useState(null)
    const [renameValue, setRenameValue] = useState('')

    async function runForVault(vaultId, action) {
        if (busyVaultId) return null
        setBusyVaultId(vaultId)
        setError(null)
        try {
            return await action()
        } catch (nextError) {
            setError(nextError)
            return null
        } finally {
            setBusyVaultId(null)
        }
    }

    async function unlockVault(vaultId) {
        await runForVault(vaultId, async () => {
            if (snapshot.selectedVaultId !== vaultId) await manager.selectVault(vaultId)
            await manager.unlock()
        })
    }

    async function renameVault(vaultId) {
        const renamed = await runForVault(vaultId, () => manager.renameSavedVault(vaultId, renameValue))
        if (renamed !== null) setRenameTarget(null)
    }

    async function exportVault(vaultId, address) {
        const backup = await runForVault(vaultId, () => manager.exportStoredVaultBackup(vaultId))
        if (backup) saveTextFile(`pistachio-wallet-${address.slice(2, 10)}.json`, backup)
    }

    if (snapshot.error?.code === 'PISTACHIO_PASSKEY_NOT_AVAILABLE') {
        return <InaccessibleWalletContent snapshot={snapshot} onRestore={onRestore} onSensitiveChange={onSensitiveChange} onStart={onStart} />
    }
    if (deleteTarget) {
        return <DeleteLocalVaultConfirmation vault={deleteTarget} onSensitiveChange={onSensitiveChange} onCancel={() => setDeleteTarget(null)} onDeleted={() => setDeleteTarget(null)} />
    }

    return (
        <div className="pistachio-wallet-stack">
            <BackButton onClick={onBack} />
            <ScreenIntro title="Saved Pistachio Wallets">Choose which encrypted wallet to unlock.</ScreenIntro>
            <div className="pistachio-saved-wallet-list">
                {snapshot.vaults.map((vault) => (
                    <article className="pistachio-saved-wallet" key={vault.vaultId}>
                        <WalletIdentity selected={vault.vaultId === snapshot.selectedVaultId} vault={vault} />
                        {renameTarget === vault.vaultId && (
                            <div className="pistachio-wallet-rename">
                                <label htmlFor={`rename-${vault.vaultId}`}>Wallet name</label>
                                <input id={`rename-${vault.vaultId}`} value={renameValue} maxLength={80} onChange={(event) => setRenameValue(event.target.value)} />
                                <div className="pistachio-wallet-button-row"><button type="button" onClick={() => setRenameTarget(null)}>Cancel</button><button className="pistachio-wallet-primary" type="button" disabled={!renameValue.trim() || busyVaultId === vault.vaultId} onClick={() => renameVault(vault.vaultId)}>Save</button></div>
                            </div>
                        )}
                        {renameTarget !== vault.vaultId && (
                            <div className="pistachio-saved-wallet-actions">
                                <button className="pistachio-wallet-primary" type="button" disabled={Boolean(busyVaultId)} onClick={() => unlockVault(vault.vaultId)}><KeyRound aria-hidden="true" /> {busyVaultId === vault.vaultId ? 'Unlocking…' : 'Unlock'}</button>
                                <button type="button" disabled={Boolean(busyVaultId)} onClick={() => { setRenameTarget(vault.vaultId); setRenameValue(vault.name) }}><Pencil aria-hidden="true" /> Rename</button>
                                <button type="button" disabled={Boolean(busyVaultId)} onClick={() => exportVault(vault.vaultId, vault.address)}><Download aria-hidden="true" /> Export encrypted backup</button>
                                <button className="pistachio-wallet-text-danger" type="button" disabled={Boolean(busyVaultId)} onClick={() => setDeleteTarget(vault)}><Trash2 aria-hidden="true" /> Remove from this browser</button>
                            </div>
                        )}
                    </article>
                ))}
            </div>
            <ErrorNotice error={error} />
        </div>
    )
}

function SetupContent({ entryScreen, initialImportMode = null, onBackupRestored, onEntryScreenChange, onSensitiveChange, snapshot }) {
    const [busy, setBusy] = useState(false)
    const busyRef = useRef(false)
    const [error, setError] = useState(null)
    const [recoveryPhrase, setRecoveryPhrase] = useState('')
    const [positions] = useState(chooseWordPositions)
    const [confirmations, setConfirmations] = useState({})
    const [phraseCopied, setPhraseCopied] = useState(false)
    const [importMode, setImportMode] = useState(initialImportMode)
    const [secretInput, setSecretInput] = useState('')
    const [keystorePassword, setKeystorePassword] = useState('')
    const [keystoreFileName, setKeystoreFileName] = useState('')
    const [backupAcknowledged, setBackupAcknowledged] = useState(false)
    const [derivedAddress, setDerivedAddress] = useState(null)
    const [addressConfirmed, setAddressConfirmed] = useState(false)

    useEffect(() => {
        const sensitive = GUARDED_SETUP_PHASES.has(snapshot.phase)
        onSensitiveChange(sensitive)
        return () => onSensitiveChange(false)
    }, [onSensitiveChange, snapshot.phase])

    async function run(action) {
        if (busyRef.current) return null
        busyRef.current = true
        setBusy(true)
        setError(null)
        try {
            return await action()
        } catch (nextError) {
            setError(nextError)
            return null
        } finally {
            busyRef.current = false
            setBusy(false)
        }
    }

    function goTo(screen) {
        setError(null)
        manager.clearError()
        onEntryScreenChange(screen)
    }

    function chooseImport(mode) {
        setImportMode(mode)
        goTo('import-risk')
    }

    async function beginSetup() {
        await run(() => manager.beginPasskeySetup())
    }

    async function createWallet() {
        const result = await run(() => manager.createMnemonicWallet())
        if (!result) return
        setRecoveryPhrase(result.recoveryPhrase)
        setDerivedAddress(result.address)
    }

    async function importWallet() {
        try {
            let result
            if (importMode === 'mnemonic') result = await run(() => manager.importMnemonic(secretInput))
            else if (importMode === 'private-key') result = await run(() => manager.importPrivateKey(secretInput))
            else result = await run(() => manager.importKeystore(secretInput, keystorePassword))
            if (result) setDerivedAddress(result.address)
        } finally {
            setSecretInput('')
            setKeystorePassword('')
            setKeystoreFileName('')
        }
    }

    async function readKeystoreFile(file) {
        if (!file) return
        setError(null)
        try {
            const text = await file.text()
            if (new TextEncoder().encode(text).byteLength > 1024 * 1024) throw new Error('Keystore exceeds 1 MiB.')
            setSecretInput(text)
            setKeystoreFileName(file.name)
        } catch (nextError) {
            setSecretInput('')
            setKeystoreFileName('')
            setError(nextError)
        }
    }

    const words = recoveryPhrase.split(' ').filter(Boolean)
    const phraseConfirmed = words.length === 12 && positions.every((position) => confirmations[position]?.trim().toLowerCase() === words[position])
    const importBackupReady = importMode === 'mnemonic' || backupAcknowledged
    const importContext = importMode === 'keystore' ? 'keystore' : 'wallet'

    async function persistGeneratedWallet() {
        const stored = await run(() => manager.persistPendingWallet())
        if (stored) {
            setRecoveryPhrase('')
            setConfirmations({})
        }
    }

    async function copyRecoveryPhrase() {
        try {
            await navigator.clipboard.writeText(recoveryPhrase)
            setPhraseCopied(true)
        } catch {
            setError(new Error('Could not copy the recovery phrase. Select and copy the words manually.'))
        }
    }

    async function finishOnboarding(continueUnlocked) {
        await manager.finishOnboarding({ continueUnlocked })
        if (continueUnlocked && !snapshot.connectionPending) manager.close()
    }

    async function exportOnboardingBackup() {
        const backup = await run(() => manager.exportEncryptedBackup())
        if (backup) saveTextFile('pistachio-wallet-backup.json', backup)
    }

    if (snapshot.phase === 'empty' || snapshot.phase === 'setup-failed') {
        if (entryScreen === 'menu') return <WalletEntryMenu onCreate={() => goTo('create')} onImport={() => goTo('import')} onRestore={() => goTo('restore')} />
        if (entryScreen === 'restore') return <RestoreBackupContent onBack={() => goTo('menu')} onRestored={onBackupRestored} />
        if (entryScreen === 'import') return <ImportChooser flags={snapshot.flags} onBack={() => goTo('menu')} onSelect={chooseImport} />
        if (entryScreen === 'import-risk' && importMode) {
            return <ImportRiskIntro busy={busy} error={error ?? snapshot.error} mode={importMode} onBack={() => goTo('import')} onContinue={beginSetup} />
        }
        return (
            <div className="pistachio-wallet-stack">
                <BackButton onClick={() => goTo('menu')} />
                <ScreenIntro title="Create a new wallet">First create a passkey. Your recovery phrase is generated only after the passkey is verified.</ScreenIntro>
                <WalletRiskNotice />
                <div className="pistachio-wallet-info"><ShieldCheck aria-hidden="true" /><p>The passkey protects encrypted wallet data. It never becomes your wallet key or recovery phrase.</p></div>
                <button className="pistachio-wallet-primary" type="button" disabled={busy} onClick={beginSetup}><KeyRound aria-hidden="true" /> {busy ? 'Creating passkey…' : snapshot.phase === 'setup-failed' ? 'Try again' : 'Create passkey and continue'}</button>
                {snapshot.error?.code === 'PISTACHIO_PASSKEY_PRF_UNSUPPORTED' && <p className="pistachio-wallet-note">Wallet creation stopped before a recovery phrase was generated. You may need to remove the unused credential from your browser or password manager.</p>}
                <ErrorNotice error={error ?? snapshot.error} />
            </div>
        )
    }

    if (snapshot.phase === 'registering-passkey') {
        return <LoadingState title="Creating and verifying your passkey">Complete the browser prompt. Pistachio Wallet will not generate a recovery phrase until verification succeeds.</LoadingState>
    }

    if (snapshot.phase === 'passkey-ready') {
        if (!importMode) {
            return (
                <div className="pistachio-wallet-stack">
                    <div className="pistachio-wallet-success" role="status"><Check aria-hidden="true" /> Passkey ready</div>
                    <ScreenIntro title="Generate your recovery phrase">Your wallet has not been created yet. The next step generates a new 12-word recovery phrase.</ScreenIntro>
                    <button className="pistachio-wallet-primary" type="button" disabled={busy} onClick={createWallet}><WalletCards aria-hidden="true" /> {busy ? 'Generating wallet…' : 'Generate recovery phrase'}</button>
                    <ErrorNotice error={error} />
                </div>
            )
        }
        return (
            <div className="pistachio-wallet-stack">
                <div className="pistachio-wallet-success" role="status"><Check aria-hidden="true" /> Passkey ready</div>
                <ScreenIntro title={IMPORT_COPY[importMode].title}>{IMPORT_COPY[importMode].description}</ScreenIntro>
                {importMode === 'keystore' ? (
                    <>
                        <label
                            className="pistachio-wallet-dropzone"
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => { event.preventDefault(); void readKeystoreFile(event.dataTransfer.files?.[0]) }}
                        >
                            <FileUp aria-hidden="true" />
                            <strong>{keystoreFileName || 'Choose or drop keystore JSON file'}</strong>
                            <span>{keystoreFileName ? 'File loaded locally' : 'Click to choose a file, or drag it here'}</span>
                            <input aria-label="Choose keystore JSON file" type="file" accept="application/json,.json" disabled={busy} onChange={(event) => { void readKeystoreFile(event.target.files?.[0]); event.target.value = '' }} />
                        </label>
                        <label htmlFor="pistachio-keystore-password">Keystore password</label>
                        <input id="pistachio-keystore-password" type="password" value={keystorePassword} autoComplete="current-password" aria-invalid={Boolean(error)} aria-describedby={error ? 'pistachio-wallet-error' : 'pistachio-keystore-help'} onChange={(event) => setKeystorePassword(event.target.value)} />
                        <p className="pistachio-wallet-note" id="pistachio-keystore-help">The password is not stored in the JSON file. It is used locally to decrypt the keystore and is then cleared.</p>
                    </>
                ) : (
                    <>
                        <label htmlFor="pistachio-wallet-secret">{importMode === 'mnemonic' ? 'Recovery phrase' : 'Private key'}</label>
                        <textarea id="pistachio-wallet-secret" value={secretInput} autoComplete="off" spellCheck="false" aria-invalid={Boolean(error)} aria-describedby={error ? 'pistachio-wallet-error' : 'pistachio-import-help'} onChange={(event) => setSecretInput(event.target.value)} />
                        <p className="pistachio-wallet-note" id="pistachio-import-help">{importMode === 'mnemonic' ? 'Enter 12, 15, 18, 21, or 24 words separated by spaces. Extra BIP-39 passphrases are not supported.' : 'Enter exactly 64 hexadecimal characters, with or without 0x. This wallet will not have a recovery phrase.'}</p>
                    </>
                )}
                {importMode !== 'mnemonic' && <label className="pistachio-wallet-check"><input type="checkbox" checked={backupAcknowledged} onChange={(event) => setBackupAcknowledged(event.target.checked)} /> I will keep and test an independent encrypted backup or offline copy of the private key.</label>}
                <button className="pistachio-wallet-primary" type="button" disabled={busy || !secretInput || !importBackupReady || (importMode === 'keystore' && !keystorePassword)} onClick={importWallet}>{busy ? 'Checking wallet…' : importMode === 'keystore' ? 'Unlock keystore and review' : 'Review imported wallet'}</button>
                <ErrorNotice error={error} context={importContext} />
            </div>
        )
    }

    if (snapshot.phase === 'confirm-recovery') {
        return (
            <div className="pistachio-wallet-stack">
                <ScreenIntro title="Save your recovery phrase">Write these words down in order. You must confirm three words before the encrypted wallet can be saved.</ScreenIntro>
                <div className="pistachio-wallet-warning"><ShieldAlert aria-hidden="true" /><div><strong>Keep these words private</strong><p>Anyone with this phrase controls the funds. PistachioSwap cannot recover it. Do not photograph, upload, or share it.</p></div></div>
                <ol className="pistachio-recovery-words" aria-label="12-word recovery phrase">{words.map((word, index) => <li key={`${index}-${word}`}><span>{index + 1}</span><strong>{word}</strong></li>)}</ol>
                <button className="pistachio-wallet-copy-phrase" type="button" disabled={busy || words.length !== 12} onClick={copyRecoveryPhrase}>{phraseCopied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{phraseCopied ? 'Copied' : 'Copy recovery phrase'}</button>
                <fieldset className="pistachio-word-confirmation">
                    <legend>Confirm your saved words</legend>
                    {positions.map((position) => {
                        const value = confirmations[position] ?? ''
                        const isCorrect = value.trim().toLowerCase() === words[position]
                        const statusId = `confirm-word-${position}-status`
                        return (
                            <label key={position} htmlFor={`confirm-word-${position}`}>
                                Word {position + 1}
                                <input
                                    id={`confirm-word-${position}`}
                                    className={isCorrect ? 'is-correct' : undefined}
                                    value={value}
                                    autoComplete="off"
                                    spellCheck="false"
                                    aria-describedby={isCorrect ? statusId : undefined}
                                    onChange={(event) => setConfirmations((current) => ({ ...current, [position]: event.target.value }))}
                                />
                                {isCorrect && <span id={statusId} className="pistachio-sr-only">Correct word</span>}
                            </label>
                        )
                    })}
                </fieldset>
                <button className="pistachio-wallet-primary" type="button" disabled={!phraseConfirmed || busy} onClick={persistGeneratedWallet}>{busy ? 'Encrypting wallet…' : 'Confirm and save wallet'}</button>
                <ErrorNotice error={error} />
            </div>
        )
    }

    if (snapshot.phase === 'confirm-import') {
        return (
            <div className="pistachio-wallet-stack">
                <ScreenIntro title="Confirm wallet address">Make sure this is the EVM wallet address you expect before saving the encrypted wallet.</ScreenIntro>
                <div className="pistachio-wallet-field-group"><span>Wallet address</span><code className="pistachio-wallet-address">{derivedAddress}</code></div>
                <label className="pistachio-wallet-check"><input type="checkbox" checked={addressConfirmed} onChange={(event) => setAddressConfirmed(event.target.checked)} /> I confirm that this is the wallet address I intend to import.</label>
                <button className="pistachio-wallet-primary" type="button" disabled={!addressConfirmed || busy} onClick={() => run(() => manager.persistPendingWallet())}>{busy ? 'Encrypting wallet…' : 'Encrypt and save wallet'}</button>
                <ErrorNotice error={error} />
            </div>
        )
    }

    if (snapshot.phase === 'persisting') return <LoadingState title="Encrypting and saving your wallet">Pistachio Wallet is verifying the encrypted browser copy. Keep this window open.</LoadingState>

    if (snapshot.phase === 'onboarding-ready') {
        return (
            <div className="pistachio-wallet-stack pistachio-wallet-complete">
                <span className="pistachio-wallet-complete-icon"><Check aria-hidden="true" /></span>
                <ScreenIntro title="Wallet saved">The encrypted wallet was saved and verified in this browser.</ScreenIntro>
                <p>A synced passkey does not sync the encrypted browser backup. Export a backup before relying on another device.</p>
                <button type="button" disabled={busy} onClick={exportOnboardingBackup}><Download aria-hidden="true" /> {busy ? 'Preparing backup…' : 'Export encrypted backup'}</button>
                <div className="pistachio-wallet-button-row">
                    <button className="pistachio-wallet-primary" type="button" onClick={() => finishOnboarding(true)}>{snapshot.connectionPending ? 'Connect wallet' : 'Done'} <ChevronRight aria-hidden="true" /></button>
                    <button type="button" onClick={() => finishOnboarding(false)}><Lock aria-hidden="true" /> Lock wallet</button>
                </div>
                <ErrorNotice error={error} />
            </div>
        )
    }

    return null
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

export default function PistachioWalletController() {
    const [snapshot, setSnapshot] = useState(manager.snapshot())
    const [entryScreen, setEntryScreen] = useState('menu')
    const [initialImportMode, setInitialImportMode] = useState(null)
    const [sensitive, setSensitive] = useState(false)
    const [closeConfirmation, setCloseConfirmation] = useState(false)
    const [closeNotice, setCloseNotice] = useState('')
    const titleRef = useRef(null)
    const openerRef = useRef(null)

    useEffect(() => {
        void manager.initialize()
        return manager.subscribe(setSnapshot)
    }, [])

    useEffect(() => {
        if (!snapshot.view) {
            setEntryScreen('menu')
            setInitialImportMode(null)
            setSensitive(false)
            setCloseConfirmation(false)
            setCloseNotice('')
        }
    }, [snapshot.view])

    useEffect(() => {
        if (!import.meta.env.DEV) return undefined
        const openWallet = () => manager.open('wallet')
        const closeWallet = () => manager.close()
        window.openPistachioWallet = openWallet
        window.closePistachioWallet = closeWallet
        return () => {
            if (window.openPistachioWallet === openWallet) delete window.openPistachioWallet
            if (window.closePistachioWallet === closeWallet) delete window.closePistachioWallet
        }
    }, [])

    const sessionRequiresUnlock =
        snapshot.sessionActive &&
        !snapshot.resumeReauthPending &&
        ['locked', 'unlocking'].includes(snapshot.phase) &&
        !snapshot.view
    const open = Boolean(snapshot.view) && !sessionRequiresUnlock
    useEffect(() => {
        if (!open) return undefined
        openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = previousOverflow
            const opener = openerRef.current
            queueMicrotask(() => opener?.isConnected && opener.focus())
        }
    }, [open])

    if (!snapshot.enabled) return null
    const setupPhase = ['empty', 'setup-failed', 'registering-passkey', 'passkey-ready', 'confirm-recovery', 'confirm-import', 'persisting', 'onboarding-ready'].includes(snapshot.phase)
    const lockedPhase = ['locked', 'unlocking'].includes(snapshot.phase)

    function requestClose() {
        setCloseNotice('')
        if (CRITICAL_PHASES.has(snapshot.phase)) {
            setCloseNotice('Finish or cancel the browser prompt before closing Pistachio Wallet.')
            return
        }
        if (sensitive || GUARDED_SETUP_PHASES.has(snapshot.phase)) {
            setCloseConfirmation(true)
            return
        }
        manager.close()
    }

    async function startAnotherWallet(importMode) {
        setInitialImportMode(importMode)
        setEntryScreen(importMode ? 'import-risk' : 'create')
        try {
            await manager.prepareNewWallet()
        } catch {
            // The manager publishes a safe setup error through its snapshot.
        }
    }

    async function unlockRestoredVault() {
        setEntryScreen('menu')
        try {
            await manager.unlock()
            manager.close()
        } catch {
            // The restored ciphertext remains saved, and the manager publishes a safe unlocked error.
        }
    }

    function cancelSetupAndReturn() {
        manager.cancelSetup()
        setInitialImportMode(null)
        setEntryScreen('menu')
        setCloseConfirmation(false)
        setSensitive(false)
        manager.close()
    }

    return createPortal(
        <>
            <Dialog.Root open={open}>
                <Dialog.Portal>
                    <Dialog.Overlay className="pistachio-wallet-overlay" />
                    <Dialog.Content
                        className="pistachio-wallet-dialog"
                        aria-describedby="pistachio-wallet-dialog-description"
                        onKeyDownCapture={() => void manager.recordActivity()}
                        onPointerDownCapture={() => void manager.recordActivity()}
                        onCloseAutoFocus={(event) => event.preventDefault()}
                        onEscapeKeyDown={(event) => { event.preventDefault(); requestClose() }}
                        onOpenAutoFocus={(event) => { event.preventDefault(); titleRef.current?.focus() }}
                        onPointerDownOutside={(event) => event.preventDefault()}
                    >
                        <header>
                            <div className="pistachio-wallet-header-brand">
                            <span className="pistachio-wallet-header-mark">
                              <img src={PistachioLogo} alt="Pistachio Logo" />
                            </span>
                                <div><Dialog.Title ref={titleRef} tabIndex={-1} className={"pt-1 "}>Pistachio Wallet</Dialog.Title></div>
                            </div>
                            <div className="pistachio-wallet-header-actions">
                                <button type="button" aria-label="Close Pistachio Wallet" onClick={requestClose}><X aria-hidden="true" /></button>
                            </div>
                        </header>
                        <p className="pistachio-sr-only" id="pistachio-wallet-dialog-description">Create, import, restore, unlock, and manage Pistachio Wallet.</p>
                        {closeConfirmation ? <ExitConfirmation phase={snapshot.phase} onCancel={() => setCloseConfirmation(false)} onConfirm={cancelSetupAndReturn} /> : (
                            <>
                                {snapshot.phase === 'initializing' && <LoadingState title="Checking for saved wallets">Reading encrypted wallet information from this browser.</LoadingState>}
                                {snapshot.phase === 'storage-error' && <StorageErrorContent snapshot={snapshot} />}
                                {setupPhase && <SetupContent entryScreen={entryScreen} initialImportMode={initialImportMode} onBackupRestored={unlockRestoredVault} onEntryScreenChange={setEntryScreen} onSensitiveChange={setSensitive} snapshot={snapshot} />}
                                {lockedPhase && snapshot.phase === 'unlocking' && <LoadingState title="Unlocking wallet">Complete the passkey prompt in your browser.</LoadingState>}
                                {lockedPhase && snapshot.phase === 'locked' && entryScreen === 'menu' && <SavedWalletEntry snapshot={snapshot} onAnother={() => setEntryScreen('another')} onChoose={() => setEntryScreen('chooser')} onRestore={() => setEntryScreen('restore')} onSensitiveChange={setSensitive} onStart={startAnotherWallet} />}
                                {lockedPhase && snapshot.phase === 'locked' && entryScreen === 'chooser' && <SavedWalletChooser snapshot={snapshot} onBack={() => setEntryScreen('menu')} onRestore={() => setEntryScreen('restore')} onSensitiveChange={setSensitive} onStart={startAnotherWallet} />}
                                {lockedPhase && snapshot.phase === 'locked' && entryScreen === 'another' && <AnotherWalletMenu flags={snapshot.flags} onBack={() => setEntryScreen('menu')} onRestore={() => setEntryScreen('restore')} onStart={startAnotherWallet} />}
                                {lockedPhase && snapshot.phase === 'locked' && entryScreen === 'restore' && <RestoreBackupContent onBack={() => setEntryScreen('menu')} onRestored={unlockRestoredVault} />}
                                {snapshot.phase === 'unlocked' && <UnlockedContent onSensitiveChange={setSensitive} snapshot={snapshot} />}
                            </>
                        )}
                        {closeNotice && <p className="pistachio-wallet-close-notice" role="status" aria-live="polite">{closeNotice}</p>}
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
            {sessionRequiresUnlock && <LockedSessionScreen snapshot={snapshot} />}
            <SigningReviewDialog />
        </>,
        document.body,
    )
}

export function PistachioWalletButton() {
    const [snapshot, setSnapshot] = useState(manager.snapshot())
    useEffect(() => manager.subscribe(setSnapshot), [])
    if (!snapshot.enabled) return null
    return (
        <button type="button" className="header-icon-button" aria-label="Open Pistachio Wallet" title="Pistachio Wallet" onClick={() => {
            void manager.recordActivity()
            manager.open('wallet')
        }}>
            {snapshot.phase === 'unlocked' || snapshot.resumeReauthPending ? <KeyRound aria-hidden="true" /> : <Lock aria-hidden="true" />}
        </button>
    )
}
