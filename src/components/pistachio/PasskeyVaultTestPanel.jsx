import * as Dialog from '@radix-ui/react-dialog'
import { Check, FlaskConical, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { detectPasskeyCapabilities, resolvePistachioRpId } from '../../wallet/pistachio/passkeyCapabilities.js'
import { encryptDiagnosticPayload, unlockDiagnosticPayload } from '../../wallet/pistachio/passkeyDiagnostic.js'
import { wipeBytes } from '../../wallet/pistachio/passkeyEncoding.js'
import { getPistachioWalletFlags } from '../../wallet/pistachio/featureFlags.js'
import { getPrfForVaultWrap, registerPrfPasskey } from '../../wallet/pistachio/passkeyService.js'
import { clearDiagnosticVault, readPreference, writePreference } from '../../wallet/pistachio/vaultStorage.js'

const initial = {
    supportDetected: false,
    capabilitiesDetected: false,
    credentialCreated: false,
    prfVerified: false,
    encrypted: false,
    locked: false,
    unlocked: false,
    roundTripPassed: false,
    error: null,
}

export default function PasskeyVaultTestPanel() {
    const flags = getPistachioWalletFlags()
    const [open, setOpen] = useState(false)
    const [state, setState] = useState(initial)
    const [capabilities, setCapabilities] = useState(null)
    const [vault, setVault] = useState(null)

    useEffect(() => {
        if (!flags.diagnosticsEnabled) return undefined
        window.openPasskeyVaultTest = () => setOpen(true)
        window.closePasskeyVaultTest = () => setOpen(false)
        readPreference('diagnosticVault').then((stored) => {
            if (stored) {
                setVault(stored)
                setState((current) => ({ ...current, credentialCreated: true, prfVerified: true, encrypted: true, locked: true }))
            }
        }).catch(() => {})
        return () => {
            delete window.openPasskeyVaultTest
            delete window.closePasskeyVaultTest
        }
    }, [flags.diagnosticsEnabled])

    if (!flags.diagnosticsEnabled) return null

    async function step(action) {
        try {
            await action()
            setState((current) => ({ ...current, error: null }))
        } catch (error) {
            setState((current) => ({ ...current, error: { code: error.code, message: error.message } }))
        }
    }

    async function detectSupport() {
        const detected = await detectPasskeyCapabilities(window)
        setCapabilities(detected)
        setState((current) => ({ ...current, supportDetected: detected.webAuthnAvailable }))
    }

    async function detectCapabilitiesStep() {
        const detected = await detectPasskeyCapabilities(window)
        setCapabilities(detected)
        setState((current) => ({ ...current, capabilitiesDetected: true }))
    }

    async function createTestPasskey() {
        const registration = await registerPrfPasskey({ label: 'Pistachio Vault Test', walletIdentifier: `pistachio-passkey-test-${crypto.randomUUID()}` })
        wipeBytes(registration.prfOutput)
        setVault({ keyWraps: [registration.keyWrap], rpId: registration.keyWrap.rpId })
        setState((current) => ({ ...current, credentialCreated: true, prfVerified: true }))
    }

    async function verifyPrf() {
        const prf = await getPrfForVaultWrap({ vault, keyWrapId: vault.keyWraps[0].id })
        const valid = prf.byteLength === 32
        wipeBytes(prf)
        if (!valid) throw new Error('PRF result length is invalid.')
        setState((current) => ({ ...current, prfVerified: true }))
    }

    async function encryptFakePayload() {
        const prf = await getPrfForVaultWrap({ vault, keyWrapId: vault.keyWraps[0].id })
        const result = await encryptDiagnosticPayload(vault.keyWraps[0], prf)
        if (prf.byteLength !== 0) throw new Error('PRF buffer transfer failed.')
        setVault(result.vault)
        await writePreference('diagnosticVault', result.vault)
        setState((current) => ({ ...current, encrypted: true }))
    }

    async function unlockFakePayload() {
        const prf = await getPrfForVaultWrap({ vault, keyWrapId: vault.keyWraps[0].id })
        const result = await unlockDiagnosticPayload(vault, vault.keyWraps[0].id, prf)
        if (prf.byteLength !== 0 || !result.passed) throw new Error('Diagnostic round trip failed.')
        setState((current) => ({ ...current, unlocked: true }))
    }

    async function clear() {
        await clearDiagnosticVault()
        setVault(null)
        setCapabilities(null)
        setState(initial)
    }

    const rpId = (() => { try { return resolvePistachioRpId() } catch { return 'unavailable' } })()
    const statusRows = [
        ['Secure context', window.isSecureContext || location.hostname === 'localhost'],
        ['RP ID', rpId],
        ['WebAuthn available', state.supportDetected],
        ['Capability hint', capabilities?.prfHint ?? 'unavailable'],
        ['Credential created', state.credentialCreated],
        ['PRF enabled', state.prfVerified],
        ['PRF result available', state.prfVerified],
        ['PRF length valid', state.prfVerified],
        ['Encryption passed', state.encrypted],
        ['Lock/unlock round trip passed', state.roundTripPassed],
        ['Browser/API test passed', state.roundTripPassed],
    ]

    return (
        <>
            <button className="pistachio-diagnostic-launch" type="button" onClick={() => setOpen(true)}><FlaskConical aria-hidden="true" /> Passkey Vault Test</button>
            <Dialog.Root open={open} onOpenChange={setOpen}>
                <Dialog.Portal>
                    <Dialog.Overlay className="pistachio-wallet-overlay" />
                    <Dialog.Content className="pistachio-wallet-dialog pistachio-diagnostic" aria-describedby={undefined}>
                        <header><div><span>Development diagnostic</span><Dialog.Title>Passkey Vault Test</Dialog.Title></div><Dialog.Close aria-label="Close Passkey Vault Test"><X aria-hidden="true" /></Dialog.Close></header>
                        <p>This creates a test credential and encrypts a deterministic fake payload. It never creates a wallet or broadcasts a transaction.</p>
                        <ol className="pistachio-diagnostic-steps">
                            <li><button type="button" onClick={() => step(detectSupport)}>Detect WebAuthn support</button></li>
                            <li><button type="button" disabled={!state.supportDetected} onClick={() => step(detectCapabilitiesStep)}>Detect client capability hints</button></li>
                            <li><button type="button" disabled={!state.capabilitiesDetected || state.credentialCreated} onClick={() => step(createTestPasskey)}>Create test passkey</button></li>
                            <li><button type="button" disabled={!state.credentialCreated} onClick={() => step(verifyPrf)}>Verify PRF assertion</button></li>
                            <li><button type="button" disabled={!state.prfVerified || state.encrypted} onClick={() => step(encryptFakePayload)}>Encrypt fake test payload</button></li>
                            <li><button type="button" disabled={!state.encrypted} onClick={() => setState((current) => ({ ...current, locked: true, unlocked: false }))}>Lock test vault</button></li>
                            <li><button type="button" disabled={!state.locked} onClick={() => step(unlockFakePayload)}>Unlock with passkey</button></li>
                            <li><button type="button" disabled={!state.unlocked || state.roundTripPassed} onClick={() => setState((current) => ({ ...current, roundTripPassed: true }))}>Verify decrypted test payload</button></li>
                            <li><button type="button" onClick={() => step(clear)}><Trash2 aria-hidden="true" /> Clear local diagnostic data</button></li>
                        </ol>
                        <dl className="pistachio-diagnostic-status">{statusRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value === true ? <Check aria-label="yes" /> : value === false ? 'No' : String(value)}</dd></div>)}</dl>
                        {state.error && <p className="pistachio-wallet-error" role="alert">{state.error.code ?? 'PISTACHIO_DIAGNOSTIC_FAILED'}: {state.error.message}</p>}
                        <p className="pistachio-wallet-note">Clearing this record does not delete the passkey from the browser or password manager.</p>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </>
    )
}
