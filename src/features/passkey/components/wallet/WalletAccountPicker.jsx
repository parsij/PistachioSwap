import * as Dialog from '@radix-ui/react-dialog'
import { Check, ChevronDown, Loader2, Plus, X } from 'lucide-react'
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
    return <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) { setError(null); setOpen(next) } }}>
        <Dialog.Trigger className="pistachio-account-picker-trigger" aria-label="Switch wallet">
            <span>{activeVault?.name ?? 'Pistachio Wallet'}{activeIndex > 0 ? ` · Wallet ${activeIndex + 1}` : ''}</span>
            <ChevronDown size={16} aria-hidden="true" />
        </Dialog.Trigger>
        <Dialog.Portal>
            <Dialog.Overlay className="pistachio-account-picker-overlay" />
            <Dialog.Content className="pistachio-account-picker" onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }} onPointerDownOutside={(event) => { if (busy) event.preventDefault() }}>
                <div className="pistachio-account-picker-heading">
                    <Dialog.Title>Wallets</Dialog.Title>
                    <Dialog.Close disabled={busy} aria-label="Close wallet picker"><X size={20} /></Dialog.Close>
                </div>
                <Dialog.Description className="pistachio-account-picker-description">Choose a wallet or create another with the same recovery phrase.</Dialog.Description>
                <div className="pistachio-account-picker-list">
                    {snapshot.vaults.map((vault) => <div key={vault.vaultId} className="pistachio-account-picker-group">
                        <p>{vault.name}<span>{vault.sourceType.endsWith('mnemonic') ? 'Recovery phrase' : 'Private key'}</span></p>
                        {(vault.accounts ?? [{ index: 0, address: vault.address }]).map((account) => {
                            const active = vault.vaultId === snapshot.selectedVaultId && account.index === activeIndex
                            return <button key={account.index} type="button" className="pistachio-account-picker-row" aria-pressed={active} disabled={busy} onClick={() => run(() => manager.selectAccount(vault.vaultId, account.index))}>
                                <WalletAvatar address={account.address} size="md" />
                                <span><strong>Wallet {account.index + 1}</strong><small>{shortAddress(account.address)}</small></span>
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
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>
}
