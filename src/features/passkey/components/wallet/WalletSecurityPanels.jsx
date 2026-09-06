import { Check, CheckCircle2, ChevronDown, ChevronRight, Fingerprint, KeyRound, Pencil, ShieldCheck, Trash2, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { walletUIOperations as manager } from '../../services/walletUIOperations.js'
import { formatLastUsed, ScreenIntro } from './WalletPrimitives.jsx'

const SECURITY_TABS = ['Overview', 'Passkeys', 'Recovery']

export function SecurityTabs({ activeTab, busy, id, onSelect }) {
    const tabRefs = useRef([])
    function handleKeyDown(event, index) {
        const last = SECURITY_TABS.length - 1
        const next = { ArrowRight: (index + 1) % SECURITY_TABS.length, ArrowLeft: (index + last) % SECURITY_TABS.length, Home: 0, End: last }[event.key]
        if (next === undefined) return
        event.preventDefault()
        onSelect(SECURITY_TABS[next])
        tabRefs.current[next]?.focus()
    }
    return (
        <div className="pistachio-security-tabs" role="tablist" aria-label="Wallet security sections">
            {SECURITY_TABS.map((tab, index) => (
                <button key={tab} ref={(element) => { tabRefs.current[index] = element }} type="button" role="tab"
                    id={`${id}-${tab}-tab`} aria-controls={`${id}-${tab}-panel`} aria-selected={activeTab === tab}
                    tabIndex={activeTab === tab ? 0 : -1} disabled={busy}
                    onClick={() => onSelect(tab)} onKeyDown={(event) => handleKeyDown(event, index)}>{tab}</button>
            ))}
        </div>
    )
}

export function SecurityOverview({ snapshot, onSelect }) {
    const count = snapshot.vault.keyWraps.length
    return (
        <>
            <ScreenIntro title="Your wallet, your control">Manage access and keep a recovery method within reach.</ScreenIntro>
            <div className="pistachio-security-overview-list">
                <button type="button" className="pistachio-security-overview-row" onClick={() => onSelect('Passkeys')}>
                    <span className="pistachio-security-symbol"><Fingerprint aria-hidden="true" /></span>
                    <span><strong>Passkeys</strong><span>{count} {count === 1 ? 'passkey' : 'passkeys'} available to unlock this wallet</span></span>
                    <ChevronRight aria-hidden="true" />
                </button>
                <button type="button" className="pistachio-security-overview-row" onClick={() => onSelect('Recovery')}>
                    <span className="pistachio-security-symbol"><ShieldCheck aria-hidden="true" /></span>
                    <span><strong>Recovery and backups</strong><span>{snapshot.recoveryBackupConfirmed ? 'Offline backup confirmed by you' : 'Keep an offline backup of your wallet'}</span></span>
                    <ChevronRight aria-hidden="true" />
                </button>
            </div>
            <p className="pistachio-security-hint">A passkey may sync while this browser’s encrypted wallet data does not. Test every backup before relying on it.</p>
        </>
    )
}

function PasskeyItem({ wrap, index, snapshot, busy, run, onRecovery }) {
    const id = useId()
    const editButton = useRef(null)
    const removeButton = useRef(null)
    const [editing, setEditing] = useState(false)
    const [label, setLabel] = useState(wrap.label)
    const [expanded, setExpanded] = useState(false)
    const [removing, setRemoving] = useState(false)
    const canRemove = snapshot.vault.keyWraps.length > 1
    const lastUsed = snapshot.lastUnlockByWrap?.[wrap.id]

    function finishEditing() {
        setEditing(false)
        editButton.current?.focus()
    }

    return (
        <article className="pistachio-security-passkey" aria-label={wrap.label}>
            <div className="pistachio-security-passkey-row">
                <span className="pistachio-security-symbol"><Fingerprint aria-hidden="true" /></span>
                <div className="pistachio-security-passkey-name">
                    <strong>{wrap.label}</strong>
                    <span className="pistachio-security-verified"><CheckCircle2 aria-hidden="true" /> Verified<span className="pistachio-sr-only"> for wallet encryption</span></span>
                    <span>Added {formatLastUsed(wrap.createdAt)}</span>
                </div>
                <div className="pistachio-security-row-actions">
                    <button ref={editButton} type="button" className="pistachio-security-icon-button" aria-label={`Rename ${wrap.label}`} aria-expanded={editing} aria-controls={`${id}-edit`} disabled={busy} onClick={() => { setLabel(wrap.label); setEditing(!editing); setRemoving(false) }}><Pencil aria-hidden="true" /></button>
                    <button type="button" className="pistachio-security-icon-button" aria-label={`Details for ${wrap.label}`} aria-expanded={expanded} aria-controls={`${id}-details`} onClick={() => setExpanded(!expanded)}><ChevronDown aria-hidden="true" /></button>
                </div>
            </div>
            {editing && (
                <form id={`${id}-edit`} className="pistachio-security-edit" onSubmit={(event) => { event.preventDefault(); void run(`rename-${wrap.id}`, async () => { await manager.renamePasskey(wrap.id, label.trim()); finishEditing() }) }}>
                    <label htmlFor={`${id}-label`}>Passkey label</label>
                    <div className="pistachio-security-input-row">
                        <input autoFocus id={`${id}-label`} value={label} maxLength={80} disabled={busy} onChange={(event) => setLabel(event.target.value)} />
                        <button className="pistachio-wallet-primary" type="submit" disabled={busy || !label.trim()} aria-label={`Save label for ${wrap.label}`}><Check aria-hidden="true" /> Save</button>
                        <button type="button" aria-label="Cancel rename" disabled={busy} onClick={finishEditing}><X aria-hidden="true" /></button>
                    </div>
                </form>
            )}
            <div className="pistachio-security-passkey-details" id={`${id}-details`} hidden={!expanded}>
                <dl>
                    <div><dt>Type</dt><dd>{index === 0 ? 'Primary passkey' : 'Backup passkey'}</dd></div>
                    <div><dt>Website</dt><dd>{wrap.rpId}</dd></div>
                    <div><dt>Last used</dt><dd>{lastUsed ? new Date(lastUsed).toLocaleString() : 'Never'}</dd></div>
                    <div><dt>Connection methods</dt><dd>{wrap.credentialTransports?.join(', ') || 'Not reported'}</dd></div>
                </dl>
                <p id={`${id}-remove-help`}>{snapshot.vault.keyWraps.length === 1 ? 'Your only passkey cannot be removed. Add another passkey first.' : !snapshot.recoveryBackupConfirmed ? 'Another passkey will remain after removal. Keep an offline recovery backup too.' : 'Removing access here does not delete the passkey from your browser, device, or password manager.'}</p>
                {!snapshot.recoveryBackupConfirmed && <button type="button" className="pistachio-security-link" disabled={busy} onClick={onRecovery}>Manage recovery</button>}
                {removing ? (
                    <div className="pistachio-security-remove-confirm" role="group" aria-label={`Confirm removal of ${wrap.label}`}>
                        <p>Remove access for “{wrap.label}”?</p>
                        <div className="pistachio-security-input-row">
                            <button type="button" className="pistachio-wallet-danger-button" disabled={busy || !canRemove} onClick={() => run(`remove-${wrap.id}`, () => manager.removePasskey(wrap.id))}>Remove passkey</button>
                            <button autoFocus type="button" disabled={busy} onClick={() => { setRemoving(false); removeButton.current?.focus() }}>Keep passkey</button>
                        </div>
                    </div>
                ) : (
                    <button ref={removeButton} type="button" className="pistachio-security-remove" aria-label={`Remove ${wrap.label}`} aria-describedby={`${id}-remove-help`} disabled={busy || !canRemove} onClick={() => setRemoving(true)}><Trash2 aria-hidden="true" /> Remove passkey</button>
                )}
            </div>
        </article>
    )
}

export function PasskeySettings({ snapshot, busy, run, onRecovery }) {
    const [newLabel, setNewLabel] = useState('Backup passkey')
    return (
        <>
            <ScreenIntro title="Passkeys">Manage how you unlock your wallet.</ScreenIntro>
            <div className="pistachio-security-passkeys">
                {snapshot.vault.keyWraps.map((wrap, index) => <PasskeyItem key={wrap.id} wrap={wrap} index={index} snapshot={snapshot} busy={busy} run={run} onRecovery={onRecovery} />)}
            </div>
            <form className="pistachio-security-add" onSubmit={(event) => { event.preventDefault(); void run('add-passkey', () => manager.addBackupPasskey(newLabel.trim())) }}>
                <label htmlFor="pistachio-new-passkey-label">New passkey label</label>
                <div className="pistachio-security-input-row">
                    <input id="pistachio-new-passkey-label" value={newLabel} disabled={busy} maxLength={80} onChange={(event) => setNewLabel(event.target.value)} />
                    <button type="submit" className="pistachio-wallet-primary" disabled={busy || !newLabel.trim()}>Add passkey</button>
                </div>
            </form>
            <div className="pistachio-security-hint"><p>Keep an offline recovery backup before removing a passkey.</p><button type="button" className="pistachio-security-link" disabled={busy} onClick={onRecovery}>Manage recovery</button></div>
            <button type="button" className="pistachio-security-test" disabled={busy} onClick={() => run('test-passkey', () => manager.reauthenticate(), 'Passkey verified. This wallet can be unlocked with it.')}><KeyRound aria-hidden="true" /> Test passkey unlock</button>
        </>
    )
}
