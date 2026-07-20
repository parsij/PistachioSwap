/* oxlint-disable no-unused-vars -- shared declarations preserve the extracted onboarding contract. */
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
import { ErrorNotice, LoadingState, WalletRiskNotice, ScreenIntro, BackButton } from './WalletPrimitives.jsx'
import { WalletEntryMenu, ImportChooser, ImportRiskIntro, RestoreBackupContent, IMPORT_COPY } from './WalletSetupScreen.jsx'
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
export { SetupContent }
