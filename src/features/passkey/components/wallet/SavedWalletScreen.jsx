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
import { ErrorNotice, ScreenIntro, BackButton, EntryButton, WalletRiskNotice, shortenAddress, sourceTypeLabel, formatLastUsed } from './WalletPrimitives.jsx'

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
            <EntryButton tone="primary" icon={WalletCards} description="Protected by a passkey" onClick={() => onStart(null)}>Create a new wallet</EntryButton>
            <div className="pistachio-wallet-entry-actions pistachio-wallet-secondary-actions">
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
            <ScreenIntro title="Previous Pistachio Wallet detected">Unlock your saved wallet or use a different one.</ScreenIntro>
            <WalletIdentity selected vault={{
                ...snapshot.vault,
                lastUsedAt: snapshot.vaults.find((candidate) => candidate.vaultId === snapshot.vault.vaultId)?.lastUsedAt,
                name: snapshot.vaults.find((candidate) => candidate.vaultId === snapshot.vault.vaultId)?.name ?? snapshot.vault.name,
            }} />
            <EntryButton tone="primary" icon={KeyRound} description="Unlock with your passkey" disabled={busy} onClick={unlockPreviousWallet}>{busy ? 'Requesting passkey…' : 'Use previous wallet'}</EntryButton>
            <div className="pistachio-wallet-entry-actions pistachio-wallet-secondary-actions">
                {snapshot.vaults.length > 1 && <EntryButton icon={WalletCards} description={`${snapshot.vaults.length} wallets saved in this browser`} onClick={onChoose}>Choose another saved wallet</EntryButton>}
                <EntryButton icon={Plus} description="Add a wallet without removing saved wallets" onClick={onAnother}>Create or import another wallet</EntryButton>
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


export { WalletIdentity, DeleteLocalVaultConfirmation, AnotherWalletMenu, InaccessibleWalletContent, SavedWalletEntry, SavedWalletChooser }
