import {
    Check,
    Copy,
    Download,
    KeyRound,
    Loader2,
    Lock,
    ShieldCheck,
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import '@fontsource/ubuntu/latin-400.css'
import '@fontsource/ubuntu/latin-500.css'
import '@fontsource/ubuntu/latin-700.css'
import { walletUIOperations as manager } from '../../services/walletUIOperations.js'
import { ErrorNotice, ScreenIntro, shortenAddress } from './WalletPrimitives.jsx'
import { PasskeySettings, SecurityOverview, SecurityTabs } from './WalletSecurityPanels.jsx'

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

function UnlockedContent({ onClose, onSensitiveChange, snapshot }) {
    const id = useId()
    const bodyRef = useRef(null)
    const [activeTab, setActiveTab] = useState('Passkeys')
    const [busyAction, setBusyAction] = useState(null)
    const [error, setError] = useState(null)
    const [notice, setNotice] = useState('')
    const secretRef = useRef(null)
    const [secretKind, setSecretKind] = useState(null)
    const [secretCopied, setSecretCopied] = useState(false)
    const [keystoreBackupPassword, setKeystoreBackupPassword] = useState('')
    const [keystoreBackupConfirmation, setKeystoreBackupConfirmation] = useState('')
    const clearTimer = useRef(null)
    const readOnlyView = snapshot.phase !== 'unlocked'
    const displayAddress = snapshot.address ?? snapshot.vault?.address ?? ''

    useEffect(() => {
        onSensitiveChange(Boolean(busyAction || secretKind))
        return () => onSensitiveChange(false)
    }, [busyAction, onSensitiveChange, secretKind])

    useEffect(() => () => {
        if (clearTimer.current) clearTimeout(clearTimer.current)
        secretRef.current = null
    }, [])

    async function run(name, action, successMessage = '') {
        if (busyAction) return null
        setBusyAction(name)
        setError(null)
        setNotice('')
        try {
            const result = await action()
            setNotice(successMessage)
            return result
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
        setSecretCopied(false)
        setSecretKind(null)
    }

    function selectTab(tab, focusTab = false) {
        if (busyAction) return
        hideSecret()
        setKeystoreBackupPassword('')
        setKeystoreBackupConfirmation('')
        setError(null)
        setNotice('')
        setActiveTab(tab)
        if (bodyRef.current) bodyRef.current.scrollTop = 0
        if (focusTab) document.getElementById(`${id}-${tab}-tab`)?.focus()
    }

    function showSecret(value, kind) {
        hideSecret()
        secretRef.current = value
        setSecretKind(kind)
        clearTimer.current = setTimeout(hideSecret, 60_000)
    }

    async function copySecret() {
        let value = String(secretRef.current ?? '')
        if (secretKind === 'Recovery phrase') {
            value = value.trim().replace(/\s+/gu, ' ')
        } else {
            value = value.trim()
        }
        if (!value) return
        try {
            if (!navigator.clipboard?.writeText) {
                throw new Error('Clipboard access is unavailable.')
            }
            await navigator.clipboard.writeText(value)
            setSecretCopied(true)
        } catch (nextError) {
            setError(nextError)
        }
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

    const recoveryWords = secretKind === 'Recovery phrase'
        ? String(secretRef.current ?? '').trim().split(/\s+/gu).filter(Boolean)
        : []

    return (
        <div className="pistachio-security">
            <div className="pistachio-security-account">
                <div role="status">
                    <span className="pistachio-security-status-dot" aria-hidden="true" />
                    {readOnlyView ? ' Wallet ready' : ' Wallet unlocked'}
                </div>
                <code>{shortenAddress(displayAddress)}</code>
            </div>
            <SecurityTabs activeTab={activeTab} busy={Boolean(busyAction)} id={id} onSelect={selectTab} />
            <div ref={bodyRef} className="pistachio-wallet-stack pistachio-security-body">
                <section className="pistachio-security-panel" role="tabpanel" tabIndex={0} id={`${id}-Overview-panel`} aria-labelledby={`${id}-Overview-tab`} hidden={activeTab !== 'Overview'}>
                    <SecurityOverview snapshot={snapshot} onSelect={(tab) => selectTab(tab, true)} />
                </section>
                <section className="pistachio-security-panel" role="tabpanel" tabIndex={0} id={`${id}-Passkeys-panel`} aria-labelledby={`${id}-Passkeys-tab`} hidden={activeTab !== 'Passkeys'}>
                    <PasskeySettings snapshot={snapshot} busy={Boolean(busyAction)} run={run} onRecovery={() => selectTab('Recovery', true)} />
                </section>
                <section className="pistachio-security-panel" role="tabpanel" tabIndex={0} id={`${id}-Recovery-panel`} aria-labelledby={`${id}-Recovery-tab`} hidden={activeTab !== 'Recovery'}>
                    <ScreenIntro title="Recovery and backups">Reauthentication is required before exporting or revealing sensitive information.</ScreenIntro>
                    <div className="pistachio-security-recovery-action">
                        <span className="pistachio-security-symbol"><Download aria-hidden="true" /></span>
                        <div><strong>Encrypted backup</strong><p>Save a file to restore this wallet on another device.</p></div>
                        <button type="button" className="pistachio-wallet-primary" disabled={Boolean(busyAction)} aria-label="Export encrypted backup" onClick={() => run('backup-export', async () => saveTextFile('pistachio-wallet-backup.json', await manager.exportEncryptedBackup()))}>Export</button>
                    </div>
                    <div className="pistachio-security-recovery-action">
                        <span className="pistachio-security-symbol"><KeyRound aria-hidden="true" /></span>
                        <div><strong>{snapshot.vault.sourceType.endsWith('mnemonic') ? 'Recovery phrase' : 'Private key'}</strong><p>View in a private place. Never share it.</p></div>
                        {snapshot.vault.sourceType.endsWith('mnemonic') ? (
                            <button type="button" disabled={Boolean(busyAction)} aria-label="Reveal recovery phrase" onClick={() => run('reveal-phrase', async () => showSecret(await manager.revealRecoveryPhrase(), 'Recovery phrase'))}>Reveal</button>
                        ) : (
                            <button type="button" disabled={Boolean(busyAction)} aria-label="Reveal private key" onClick={() => run('reveal-key', async () => showSecret(await manager.revealPrivateKey(), 'Private key'))}>Reveal</button>
                        )}
                    </div>
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
                            {secretKind === 'Recovery phrase' ? (
                                <>
                                    <ol
                                        aria-label="Recovery phrase words"
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                            gap: '8px 16px',
                                            listStyle: 'none',
                                            margin: 0,
                                            padding: 0,
                                        }}
                                    >
                                        {recoveryWords.map((word, index) => (
                                            <li
                                                key={`${index}-${word}`}
                                                style={{
                                                    alignItems: 'center',
                                                    display: 'grid',
                                                    gridTemplateColumns: '2rem minmax(0, 1fr)',
                                                    gap: '8px',
                                                }}
                                            >
                                                <span aria-hidden="true" style={{ opacity: 0.65, textAlign: 'right' }}>{index + 1}.</span>
                                                <span style={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{word}</span>
                                            </li>
                                        ))}
                                    </ol>
                                    <div className="pistachio-wallet-inline">
                                        <button type="button" onClick={copySecret}>
                                            <Copy aria-hidden="true" /> {secretCopied ? 'Copied' : 'Copy recovery phrase'}
                                        </button>
                                        <button type="button" onClick={hideSecret}>Hide</button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <code>{secretRef.current}</code>
                                    <div className="pistachio-wallet-inline">
                                        <button type="button" onClick={copySecret}>
                                            <Copy aria-hidden="true" /> {secretCopied ? 'Copied' : 'Copy private key'}
                                        </button>
                                        <button type="button" onClick={hideSecret}>Hide</button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                    <div className="pistachio-security-backup-confirmation">
                        {snapshot.recoveryBackupConfirmed ? <p className="pistachio-security-verified"><ShieldCheck aria-hidden="true" /> Offline backup confirmed by you</p> : <label className="pistachio-wallet-check"><input type="checkbox" checked={false} disabled={Boolean(busyAction)} onChange={(event) => event.target.checked && run('confirm-backup', () => manager.confirmRecoveryBackup())} /> I have an offline wallet recovery backup.</label>}
                        <p>A passkey may sync while this browser’s encrypted wallet data does not. Test every backup before relying on it.</p>
                    </div>
                </section>
                {busyAction && <p className="pistachio-wallet-progress" role="status" aria-live="polite"><Loader2 className="pistachio-wallet-spinner" aria-hidden="true" /> Complete the requested wallet check…</p>}
                {notice && <p className="pistachio-security-verified" role="status"><Check aria-hidden="true" /> {notice}</p>}
                <ErrorNotice error={error} />
            </div>
            <footer className="pistachio-security-footer">
                <button type="button" disabled={Boolean(busyAction)} onClick={() => { hideSecret(); manager.lock('manual') }}><Lock aria-hidden="true" /> Lock wallet</button>
                <button type="button" className="pistachio-wallet-primary" disabled={Boolean(busyAction)} onClick={onClose ?? (() => { hideSecret(); manager.close() })}>Done</button>
            </footer>
        </div>
    )
}


export { UnlockedContent }
