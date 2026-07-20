import * as Dialog from '@radix-ui/react-dialog'
import { KeyRound, Lock, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getPistachioWalletManager } from '../services/walletManager.js'
import { LoadingState, SetupContent, SavedWalletEntry, SavedWalletChooser, AnotherWalletMenu, RestoreBackupContent, UnlockedContent, SigningReviewDialog, StorageErrorContent, LockedSessionScreen, ExitConfirmation } from './PistachioWalletScreens.jsx'
import '@fontsource/ubuntu/latin-400.css'
import '@fontsource/ubuntu/latin-500.css'
import '@fontsource/ubuntu/latin-700.css'
import './pistachioWallet.css'

const manager = getPistachioWalletManager()
const PISTACHIO_LOGO_URL = '/icons/PistachioLogo.svg'
const CRITICAL_PHASES = new Set(['registering-passkey', 'unlocking', 'persisting'])
const GUARDED_SETUP_PHASES = new Set(['passkey-ready', 'confirm-recovery', 'confirm-import', 'onboarding-ready'])

/**
 * Renders and coordinates Pistachio Wallet setup, vault/session, lock/unlock, and signing-review screens.
 * @returns {import('react').ReactElement|null} Feature modal/controller UI for the current manager snapshot.
 * @sideEffects Delegates passkey, encrypted storage, backup, lock, and signing operations to the wallet manager.
 * @security Sensitive material remains service-owned and explicit signing review is required.
 */
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
                                    <img src={PISTACHIO_LOGO_URL} alt="" />
                                </span>
                                <div>
                                    <Dialog.Title ref={titleRef} tabIndex={-1}>Pistachio Wallet</Dialog.Title>
                                </div>
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

/**
 * Renders the header entry point for Pistachio Wallet.
 * @returns {import('react').ReactElement} Existing accessible wallet button.
 * @sideEffects Opens the Pistachio wallet controller through its existing state bridge.
 */
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
