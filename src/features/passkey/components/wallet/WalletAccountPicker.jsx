import * as Dialog from '@radix-ui/react-dialog'
import { Check, ChevronDown, Loader2, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getPistachioWalletManager } from '../../services/walletManager.js'
import { WalletAvatar } from '../../../wallet/components/wallet/WalletAccountButton.jsx'
import './walletAccountPicker.css'

const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`
export default function WalletAccountPicker({ onAddWallet, manager = getPistachioWalletManager() }) {
    const [snapshot, setSnapshot] = useState(() => manager.snapshot())
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const [removal, setRemoval] = useState(null)
    const [remaining, setRemaining] = useState(10)
    const [backupAcknowledged, setBackupAcknowledged] = useState(false)
    const [confirmation, setConfirmation] = useState('')
    useEffect(() => {
        if (!removal || !open) return
        const update = () => setRemaining(Math.max(0, Math.ceil((removal.deadline - Date.now()) / 1000)))
        update()
        const timer = setInterval(update, 250)
        return () => clearInterval(timer)
    }, [removal, open])
    function requestRemoval(vault) {
        setRemoval({ vault, deadline: Date.now() + 10_000 })
        setRemaining(10)
        setBackupAcknowledged(false)
        setConfirmation('')
        setError(null)
    }
    const canRemove = removal && remaining === 0 && backupAcknowledged && confirmation === 'DELETE' && !busy
    async function removeWallet() {
        if (!canRemove || Date.now() < removal.deadline) return
        await run(async () => {
            await manager.deleteLocalVault(removal.vault.vaultId, { backupAcknowledged, confirmation })
            setRemoval(null)
        }, false)
    }
    useEffect(() => {
        const unsubscribe = manager.subscribe(setSnapshot)
        void manager.initialize().catch((reason) => setError(reason.message))
        return unsubscribe
    }, [manager])
    async function run(action, close = true) {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
            await action()
            if (close) setOpen(false)
        } catch (reason) { setError(reason.message) }
        finally { setBusy(false) }
    }
    const activeVault = snapshot.vaults.find((vault) => vault.vaultId === snapshot.selectedVaultId)
    const activeIndex = snapshot.selectedAccountIndex ?? 0
    return <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) { setError(null); setRemoval(null); setOpen(next) } }}>
        <Dialog.Trigger className="pistachio-account-picker-trigger" aria-label="Switch wallet">
            <span>Pistachio Wallet {activeIndex + 1}</span>
            <ChevronDown size={16} aria-hidden="true" />
        </Dialog.Trigger>
        <Dialog.Portal>
            <Dialog.Overlay className="pistachio-account-picker-overlay" />
            <Dialog.Content role={removal ? "alertdialog" : "dialog"} className="pistachio-account-picker" onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }} onPointerDownOutside={(event) => { if (busy) event.preventDefault() }}>
                <div className="pistachio-account-picker-heading">
                    <Dialog.Title>{removal ? "Remove saved wallet?" : "Wallets"}</Dialog.Title>
                    <Dialog.Close disabled={busy} aria-label="Close wallet picker"><X size={20} /></Dialog.Close>
                </div>
                {removal ? <>
                    <Dialog.Description className="pistachio-account-picker-description">
                        This deletes the encrypted wallet from this device. Without its recovery phrase, private key, or encrypted backup, you may permanently lose access. Your passkey alone cannot restore it. Funds on the blockchain are not deleted.
                    </Dialog.Description>
                    <div className="pistachio-account-picker-list pistachio-wallet-removal">
                        <strong>{removal.vault.name}</strong>
                        {(removal.vault.accounts ?? [{ index: 0, address: removal.vault.address }]).map(account => <small key={account.index}>{account.address}</small>)}
                        {(removal.vault.accounts?.length ?? 1) > 1 && <p>All {removal.vault.accounts.length} wallets in this recovery phrase group will be removed from this device.</p>}
                        <label><input type="checkbox" checked={backupAcknowledged} disabled={busy} onChange={event => setBackupAcknowledged(event.target.checked)} /> I have saved my recovery phrase, private key, or encrypted backup.</label>
                        <label>Type DELETE to confirm<input aria-label="Type DELETE to confirm" value={confirmation} disabled={busy} autoComplete="off" onChange={event => setConfirmation(event.target.value)} /></label>
                    </div>
                    {error && <p className="pistachio-account-picker-error" role="alert">{error}</p>}
                    <div className="pistachio-account-picker-actions">
                        <button type="button" disabled={busy} onClick={() => { setRemoval(null); setError(null) }}>Cancel</button>
                        <button type="button" className="pistachio-wallet-delete-confirm" disabled={!canRemove} onClick={removeWallet}>{busy ? 'Removing…' : remaining > 0 ? `Remove wallet (${remaining}s)` : 'Remove wallet'}</button>
                    </div>
                </> : <>
                <Dialog.Description className="pistachio-account-picker-description">Choose a wallet or create another with the same recovery phrase.</Dialog.Description>
                <div className="pistachio-account-picker-list">
                    {snapshot.vaults.map((vault) => <div key={vault.vaultId} className="pistachio-account-picker-group">
                        <p><span>{vault.name}</span><button type="button" className="pistachio-wallet-trash" disabled={busy} aria-label={`Remove ${vault.name} (${shortAddress(vault.address)})`} onClick={() => requestRemoval(vault)}><Trash2 size={18} aria-hidden="true" /></button></p>
                        {(vault.accounts ?? [{ index: 0, address: vault.address }]).map((account) => {
                            const active = vault.vaultId === snapshot.selectedVaultId && account.index === activeIndex
                            return <button key={account.index} type="button" className="pistachio-account-picker-row" aria-pressed={active} disabled={busy} onClick={() => run(() => manager.selectAccount(vault.vaultId, account.index))}>
                                <WalletAvatar address={account.address} size="md" />
                                <span><strong>Pistachio Wallet {account.index + 1}</strong><small>{shortAddress(account.address)}</small></span>
                                {active && <Check size={20} aria-label="Selected wallet" />}
                            </button>
                        })}
                    </div>)}
                </div>
                {error && <p className="pistachio-account-picker-error" role="alert">{error}</p>}
                <div className="pistachio-account-picker-actions">
                    <button type="button" disabled={busy || !activeVault?.sourceType.endsWith('mnemonic')} onClick={() => run(() => manager.createAccount())}>
                        {busy ? <Loader2 className="spinning" size={20} /> : <Plus size={20} />} Create wallet
                    </button>
                    <small>{activeVault?.sourceType.endsWith('mnemonic') ? 'Uses this recovery phrase · Confirm with your passkey' : 'Import a recovery phrase to create additional wallets'}</small>
                    <button type="button" disabled={busy} onClick={() => run(async () => { await manager.prepareNewWallet(); setOpen(false); onAddWallet?.(); manager.open('wallet') })}>Add or import another wallet</button>
                </div>
                </>}
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>
}
