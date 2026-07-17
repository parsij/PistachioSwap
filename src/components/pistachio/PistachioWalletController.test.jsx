// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
    const state = { listener: null, reviewListener: null, snapshot: null }
    const publish = (patch) => {
        state.snapshot = { ...state.snapshot, ...patch }
        state.listener?.(state.snapshot)
    }
    const manager = {
        addBackupPasskey: vi.fn(async () => undefined),
        beginPasskeySetup: vi.fn(async () => undefined),
        cancelSetup: vi.fn(() => true),
        clearError: vi.fn(() => undefined),
        close: vi.fn(() => { publish({ view: null }); return true }),
        confirmRecoveryBackup: vi.fn(async () => undefined),
        disconnect: vi.fn(async () => publish({ sessionActive: false, view: null })),
        createMnemonicWallet: vi.fn(async () => undefined),
        deleteLocalVault: vi.fn(async () => undefined),
        exportEncryptedBackup: vi.fn(async () => '{}'),
        exportKeystore: vi.fn(async () => '{}'),
        exportStoredVaultBackup: vi.fn(async () => '{}'),
        finishOnboarding: vi.fn(async () => undefined),
        importKeystore: vi.fn(async () => undefined),
        importMnemonic: vi.fn(async () => undefined),
        importPrivateKey: vi.fn(async () => undefined),
        initialize: vi.fn(async () => undefined),
        lock: vi.fn(async () => undefined),
        open: vi.fn((view = 'wallet') => publish({ view })),
        persistPendingWallet: vi.fn(async () => ({ vaultId: 'new-vault' })),
        prepareNewWallet: vi.fn(async () => publish({ phase: 'empty', vault: null })),
        recordActivity: vi.fn(),
        reauthenticate: vi.fn(async () => true),
        removePasskey: vi.fn(async () => undefined),
        renamePasskey: vi.fn(async () => undefined),
        renameSavedVault: vi.fn(async () => true),
        restoreEncryptedBackup: vi.fn(async () => undefined),
        retryInitialization: vi.fn(async () => undefined),
        revealPrivateKey: vi.fn(async () => '0x' + '11'.repeat(32)),
        revealRecoveryPhrase: vi.fn(async () => 'test-only recovery phrase'),
        selectVault: vi.fn(async () => undefined),
        unlock: vi.fn(async () => undefined),
        reviewQueue: {
            approve: vi.fn(),
            clear: vi.fn(),
            reject: vi.fn(),
            subscribe: vi.fn((listener) => {
                state.reviewListener = listener
                listener(null)
                return () => { if (state.reviewListener === listener) state.reviewListener = null }
            }),
        },
        snapshot: vi.fn(() => state.snapshot),
        subscribe: vi.fn((listener) => {
            state.listener = listener
            return () => { if (state.listener === listener) state.listener = null }
        }),
    }
    return { manager, publish, state }
})

vi.mock('../../wallet/pistachio/walletManager.js', () => ({
    getPistachioWalletManager: () => mocks.manager,
}))

import PistachioWalletController from './PistachioWalletController.jsx'

const emptySnapshot = {
    address: null,
    connectionPending: false,
    enabled: true,
    error: null,
    flags: {
        keystoreImportEnabled: true,
        walletImportEnabled: true,
    },
    lastUnlockByWrap: {},
    phase: 'empty',
    recoveryBackupConfirmed: false,
    sessionActive: false,
    selectedVaultId: null,
    vault: null,
    vaults: [],
    view: 'wallet',
}

const savedVault = {
    address: '0x1111111111111111111111111111111111111111',
    createdAt: '2026-01-01T00:00:00.000Z',
    keyWraps: [{
        createdAt: '2026-01-01T00:00:00.000Z',
        credentialTransports: ['internal'],
        id: 'wrap-1',
        label: 'Primary passkey',
        rpId: 'localhost',
    }],
    name: 'Pistachio Wallet',
    sourceType: 'generated-mnemonic',
    updatedAt: '2026-01-01T00:00:00.000Z',
    vaultId: '10000000-0000-4000-8000-000000000001',
}

const savedVaultSnapshot = {
    ...emptySnapshot,
    phase: 'locked',
    selectedVaultId: savedVault.vaultId,
    vault: savedVault,
    vaults: [{
        address: savedVault.address,
        lastUsedAt: savedVault.updatedAt,
        name: savedVault.name,
        sourceType: savedVault.sourceType,
        vaultId: savedVault.vaultId,
    }],
}

function resetManager() {
    mocks.state.listener = null
    mocks.state.reviewListener = null
    mocks.state.snapshot = { ...emptySnapshot }
    for (const value of Object.values(mocks.manager)) {
        if (typeof value?.mockClear === 'function') value.mockClear()
    }
    for (const value of Object.values(mocks.manager.reviewQueue)) {
        if (typeof value?.mockClear === 'function') value.mockClear()
    }
    mocks.manager.close.mockImplementation(() => { mocks.publish({ view: null }); return true })
    mocks.manager.disconnect.mockImplementation(async () => mocks.publish({ sessionActive: false, view: null }))
    mocks.manager.open.mockImplementation((view = 'wallet') => mocks.publish({ view }))
    mocks.manager.prepareNewWallet.mockImplementation(async () => mocks.publish({ phase: 'empty', vault: null }))
    mocks.manager.clearError.mockImplementation(() => undefined)
    mocks.manager.cancelSetup.mockImplementation(() => true)
    mocks.manager.initialize.mockResolvedValue(undefined)
    mocks.manager.beginPasskeySetup.mockResolvedValue(undefined)
    mocks.manager.createMnemonicWallet.mockResolvedValue(undefined)
    mocks.manager.persistPendingWallet.mockResolvedValue({ vaultId: 'new-vault' })
    mocks.manager.restoreEncryptedBackup.mockResolvedValue(savedVault)
    mocks.manager.unlock.mockResolvedValue(savedVault.address)
    mocks.manager.importMnemonic.mockResolvedValue({ address: savedVault.address })
    mocks.manager.importPrivateKey.mockResolvedValue({ address: savedVault.address })
    mocks.manager.importKeystore.mockResolvedValue({ address: savedVault.address })
    mocks.manager.renameSavedVault.mockResolvedValue(true)
    mocks.manager.exportStoredVaultBackup.mockResolvedValue('{}')
    mocks.manager.reviewQueue.subscribe.mockImplementation((listener) => {
        mocks.state.reviewListener = listener
        listener(null)
        return () => { if (mocks.state.reviewListener === listener) mocks.state.reviewListener = null }
    })
}

async function openImportRisk(user, option = /^Recovery phrase/) {
    await user.click(screen.getByRole('button', { name: /^Import an existing wallet/ }))
    await user.click(screen.getByRole('button', { name: option }))
}

async function completeImportPasskeyStep(user) {
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Create passkey and continue' }))
}

describe('Pistachio Wallet entry and modal behavior', () => {
    beforeEach(resetManager)
    afterEach(() => {
        cleanup()
        document.body.style.overflow = ''
        document.body.style.pointerEvents = ''
        document.body.removeAttribute('data-scroll-locked')
    })

    it('renders one accessible modal through document.body with required no-vault wording', () => {
        const stackingContainer = document.createElement('div')
        stackingContainer.style.transform = 'translateZ(0)'
        document.body.append(stackingContainer)
        render(<PistachioWalletController />, { container: stackingContainer })

        const dialogs = screen.getAllByRole('dialog', { name: 'Pistachio Wallet' })
        expect(dialogs).toHaveLength(1)
        expect(document.body.contains(dialogs[0])).toBe(true)
        expect(stackingContainer.contains(dialogs[0])).toBe(false)
        expect(screen.getByText('Create a new wallet or bring an existing wallet to PistachioSwap.')).toBeTruthy()
        expect(screen.getByRole('button', { name: /^Create a new wallet/ })).toBeTruthy()
        expect(screen.getByText('Recommended')).toBeTruthy()
        expect(screen.getByRole('button', { name: /^Import an existing wallet/ })).toBeTruthy()
        expect(screen.getByRole('button', { name: /^Restore encrypted backup/ })).toBeTruthy()
    })

    it('covers the application with an unlock screen when an active Pistachio session locks', async () => {
        const user = userEvent.setup()
        mocks.state.snapshot = { ...savedVaultSnapshot, phase: 'locked', sessionActive: true, view: null }
        mocks.manager.unlock.mockImplementation(async () => {
            mocks.publish({ address: null, phase: 'unlocking' })
            mocks.publish({ address: savedVault.address, phase: 'unlocked' })
            return savedVault.address
        })
        render(<PistachioWalletController />)

        expect(screen.getByRole('dialog', { name: 'Pistachio Wallet is locked' })).toBeTruthy()
        expect(document.querySelector('.pistachio-session-lock-overlay')).toBeTruthy()
        expect(screen.queryByRole('dialog', { name: 'Pistachio Wallet' })).toBeNull()
        await user.click(screen.getByRole('button', { name: 'Unlock wallet' }))
        expect(mocks.manager.unlock).toHaveBeenCalledOnce()
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pistachio Wallet is locked' })).toBeNull())
    })

    it('does not show the lock overlay for a refreshed session awaiting signing reauthentication', () => {
        mocks.state.snapshot = {
            ...savedVaultSnapshot,
            phase: 'locked',
            sessionActive: true,
            resumeReauthPending: true,
            view: null,
        }
        render(<PistachioWalletController />)

        expect(screen.queryByRole('dialog', {
            name: 'Pistachio Wallet is locked',
        })).toBeNull()
        expect(document.querySelector('.pistachio-session-lock-overlay')).toBeNull()
    })

    it('keeps the existing disconnected UI when there is no active Pistachio session', () => {
        mocks.state.snapshot = { ...savedVaultSnapshot, phase: 'locked', sessionActive: false, view: null }
        render(<PistachioWalletController />)
        expect(screen.queryByRole('dialog', { name: 'Pistachio Wallet is locked' })).toBeNull()
        expect(document.querySelector('.pistachio-session-lock-overlay')).toBeNull()
    })

    it('blocks duplicate passkey requests from the lock screen', async () => {
        let finishUnlock
        mocks.state.snapshot = { ...savedVaultSnapshot, phase: 'locked', sessionActive: true, view: null }
        mocks.manager.unlock.mockImplementation(() => new Promise((resolve) => { finishUnlock = resolve }))
        render(<PistachioWalletController />)

        const unlockButton = screen.getByRole('button', { name: 'Unlock wallet' })
        fireEvent.click(unlockButton)
        fireEvent.click(unlockButton)
        expect(mocks.manager.unlock).toHaveBeenCalledOnce()
        expect(screen.getByRole('button', { name: 'Waiting for passkey…' }).disabled).toBe(true)
        finishUnlock(savedVault.address)
    })

    it('requires confirmation before disconnecting a locked Pistachio Wallet session', async () => {
        const user = userEvent.setup()
        mocks.state.snapshot = { ...savedVaultSnapshot, phase: 'locked', sessionActive: true, view: null }
        render(<PistachioWalletController />)

        const disconnectButton = screen.getByRole('button', { name: 'Disconnect wallet' })
        expect(disconnectButton.classList.contains('pistachio-session-disconnect-button')).toBe(true)
        await user.click(disconnectButton)
        const confirmation = screen.getByRole('dialog', { name: 'Disconnect Pistachio Wallet?' })
        expect(mocks.manager.disconnect).not.toHaveBeenCalled()
        expect(within(confirmation).getByText(/encrypted wallet stays saved in this browser/i)).toBeTruthy()
        await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
        expect(screen.queryByRole('dialog', { name: 'Disconnect Pistachio Wallet?' })).toBeNull()

        await user.click(screen.getByRole('button', { name: 'Disconnect wallet' }))
        await user.click(within(screen.getByRole('dialog', { name: 'Disconnect Pistachio Wallet?' })).getByRole('button', { name: 'Disconnect' }))
        expect(mocks.manager.disconnect).toHaveBeenCalledOnce()
    })

    it('keeps the body locked while open and restores focus and scrolling after close', async () => {
        const user = userEvent.setup()
        const opener = document.createElement('button')
        opener.textContent = 'Open wallet'
        document.body.append(opener)
        opener.focus()
        render(<PistachioWalletController />)

        expect(document.body.style.overflow).toBe('hidden')
        await user.click(screen.getByRole('button', { name: 'Close Pistachio Wallet' }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pistachio Wallet' })).toBeNull())
        await waitFor(() => expect(document.body.style.overflow).toBe(''))
        await waitFor(() => expect(document.activeElement).toBe(opener))
        opener.remove()
    })

    it('traps keyboard focus in the dialog and gives icon-only close an accessible name', async () => {
        const user = userEvent.setup()
        render(<PistachioWalletController />)
        const dialog = screen.getByRole('dialog', { name: 'Pistachio Wallet' })
        expect(screen.getByRole('button', { name: 'Close Pistachio Wallet' })).toBeTruthy()
        for (let index = 0; index < 8; index += 1) await user.tab()
        expect(dialog.contains(document.activeElement)).toBe(true)
    })

    it('closes with Escape on a safe menu but ignores overlay clicks', async () => {
        const user = userEvent.setup()
        const { container } = render(<PistachioWalletController />)
        const overlay = document.body.querySelector('.pistachio-wallet-overlay')
        fireEvent.pointerDown(overlay)
        fireEvent.click(overlay)
        expect(mocks.manager.close).not.toHaveBeenCalled()
        expect(container.ownerDocument.body.querySelector('[role="dialog"]')).toBeTruthy()

        await user.keyboard('{Escape}')
        expect(mocks.manager.close).toHaveBeenCalledOnce()
    })

    it('opens and closes with the development console commands', async () => {
        mocks.state.snapshot = { ...emptySnapshot, view: null }
        render(<PistachioWalletController />)

        expect(screen.queryByRole('dialog')).toBeNull()
        act(() => window.openPistachioWallet())
        expect(await screen.findByRole('dialog')).toBeTruthy()
        expect(mocks.manager.open).toHaveBeenCalledWith('wallet')

        act(() => window.closePistachioWallet())
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        expect(mocks.manager.close).toHaveBeenCalledOnce()
    })

    it('reopens from a clean no-vault menu after close', async () => {
        const user = userEvent.setup()
        render(<PistachioWalletController />)
        await user.click(screen.getByRole('button', { name: /^Import an existing wallet/ }))
        expect(screen.getByRole('heading', { name: 'Import an existing wallet' })).toBeTruthy()
        await user.click(screen.getByRole('button', { name: 'Close Pistachio Wallet' }))
        act(() => mocks.manager.open('wallet'))
        expect(await screen.findByText('Create a new wallet or bring an existing wallet to PistachioSwap.')).toBeTruthy()
    })

    it('shows only import methods enabled by feature flags', async () => {
        const user = userEvent.setup()
        mocks.state.snapshot = { ...emptySnapshot, flags: { keystoreImportEnabled: false, walletImportEnabled: true } }
        render(<PistachioWalletController />)
        await user.click(screen.getByRole('button', { name: /^Import an existing wallet/ }))

        expect(screen.getByRole('button', { name: /^Recovery phrase/ })).toBeTruthy()
        expect(screen.getByRole('button', { name: /^Private key/ })).toBeTruthy()
        expect(screen.queryByRole('button', { name: /^Keystore file/ })).toBeNull()
    })

    it('shows security guidance before starting passkey-first creation', async () => {
        const user = userEvent.setup()
        render(<PistachioWalletController />)
        await user.click(screen.getByRole('button', { name: /^Create a new wallet/ }))

        expect(mocks.manager.beginPasskeySetup).not.toHaveBeenCalled()
        expect(screen.getByText(/recovery phrase is generated only after the passkey is verified/i)).toBeTruthy()
        await user.click(screen.getByRole('button', { name: 'Create passkey and continue' }))
        expect(mocks.manager.beginPasskeySetup).toHaveBeenCalledOnce()
    })

    it('requires import risk acknowledgement before starting passkey setup', async () => {
        const user = userEvent.setup()
        render(<PistachioWalletController />)
        await openImportRisk(user)

        const continueButton = screen.getByRole('button', { name: 'Create passkey and continue' })
        expect(continueButton.disabled).toBe(true)
        expect(mocks.manager.beginPasskeySetup).not.toHaveBeenCalled()
        await user.click(screen.getByRole('checkbox'))
        await user.click(continueButton)
        expect(mocks.manager.beginPasskeySetup).toHaveBeenCalledOnce()
    })

    it('blocks duplicate create-passkey clicks', async () => {
        let resolveSetup
        mocks.manager.beginPasskeySetup.mockImplementation(() => new Promise((resolve) => { resolveSetup = resolve }))
        render(<PistachioWalletController />)
        fireEvent.click(screen.getByRole('button', { name: /^Create a new wallet/ }))
        const createPasskey = screen.getByRole('button', { name: 'Create passkey and continue' })
        fireEvent.click(createPasskey)
        fireEvent.click(createPasskey)
        expect(mocks.manager.beginPasskeySetup).toHaveBeenCalledOnce()
        resolveSetup()
    })

    it('shows a recoverable safe error after passkey cancellation', async () => {
        const user = userEvent.setup()
        const cancellation = Object.assign(new Error('internal browser detail'), { code: 'PISTACHIO_PASSKEY_NOT_AVAILABLE' })
        mocks.manager.beginPasskeySetup.mockRejectedValueOnce(cancellation).mockResolvedValueOnce(undefined)
        render(<PistachioWalletController />)
        await user.click(screen.getByRole('button', { name: /^Create a new wallet/ }))
        await user.click(screen.getByRole('button', { name: 'Create passkey and continue' }))

        expect((await screen.findByRole('alert')).textContent).toContain('The passkey request was canceled or the matching passkey is unavailable.')
        expect(screen.queryByText('internal browser detail')).toBeNull()
        await user.click(screen.getByRole('button', { name: 'Create passkey and continue' }))
        expect(mocks.manager.beginPasskeySetup).toHaveBeenCalledTimes(2)
    })

    it('requires recovery word confirmation and provides no skip action', async () => {
        const user = userEvent.setup()
        const phrase = Array.from({ length: 12 }, () => 'testword').join(' ')
        mocks.manager.createMnemonicWallet.mockImplementation(async () => {
            mocks.publish({ phase: 'confirm-recovery' })
            return { address: savedVault.address, recoveryPhrase: phrase }
        })
        mocks.state.snapshot = { ...emptySnapshot, phase: 'passkey-ready' }
        render(<PistachioWalletController />)
        await user.click(screen.getByRole('button', { name: 'Generate recovery phrase' }))

        const saveButton = await screen.findByRole('button', { name: 'Confirm and save wallet' })
        expect(saveButton.disabled).toBe(true)
        expect(screen.queryByRole('button', { name: /Skip/ })).toBeNull()
        const inputs = screen.getAllByLabelText(/^Word \d+$/)
        await user.type(inputs[0], 'wrongword')
        expect(inputs[0].classList.contains('is-correct')).toBe(false)
        expect(saveButton.disabled).toBe(true)
        await user.clear(inputs[0])
        for (const input of inputs) {
            await user.type(input, ' TESTWORD ')
            expect(input.classList.contains('is-correct')).toBe(true)
            expect(input.getAttribute('aria-describedby')).toBeTruthy()
        }
        expect(screen.getAllByText('Correct word')).toHaveLength(inputs.length)
        expect(saveButton.disabled).toBe(false)
        await user.click(saveButton)
        expect(mocks.manager.persistPendingWallet).toHaveBeenCalledOnce()
    })

    it('copies the displayed fake recovery phrase only after explicit click', async () => {
        const user = userEvent.setup()
        const phrase = Array.from({ length: 12 }, () => 'testword').join(' ')
        const writeText = vi.fn(async () => undefined)
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
        mocks.manager.createMnemonicWallet.mockImplementation(async () => {
            mocks.publish({ phase: 'confirm-recovery' })
            return { address: savedVault.address, recoveryPhrase: phrase }
        })
        mocks.state.snapshot = { ...emptySnapshot, phase: 'passkey-ready' }
        render(<PistachioWalletController />)
        await user.click(screen.getByRole('button', { name: 'Generate recovery phrase' }))
        expect(writeText).not.toHaveBeenCalled()
        await user.click(await screen.findByRole('button', { name: 'Copy recovery phrase' }))
        expect(writeText).toHaveBeenCalledWith(phrase)
        expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    })

    it('guards Escape while a recovery phrase is visible', async () => {
        const user = userEvent.setup()
        mocks.state.snapshot = { ...emptySnapshot, phase: 'confirm-recovery' }
        render(<PistachioWalletController />)
        await user.keyboard('{Escape}')
        expect(mocks.manager.close).not.toHaveBeenCalled()
        expect(screen.getByText('Leave this wallet flow?')).toBeTruthy()
        await user.click(screen.getByRole('button', { name: 'Continue setup' }))
        expect(screen.getByRole('dialog')).toBeTruthy()
    })

    it('prevents close while encrypted persistence is active', async () => {
        const user = userEvent.setup()
        mocks.state.snapshot = { ...emptySnapshot, phase: 'persisting' }
        render(<PistachioWalletController />)
        await user.click(screen.getByRole('button', { name: 'Close Pistachio Wallet' }))
        expect(mocks.manager.close).not.toHaveBeenCalled()
        expect(screen.getByText('Finish or cancel the browser prompt before closing Pistachio Wallet.')).toBeTruthy()
    })

    it('provides a retry path when encrypted browser storage is unavailable', async () => {
        const user = userEvent.setup()
        mocks.state.snapshot = { ...emptySnapshot, error: { code: 'PISTACHIO_WALLET_STORAGE_FAILED' }, phase: 'storage-error' }
        render(<PistachioWalletController />)
        expect(screen.getByRole('heading', { name: 'Encrypted storage unavailable' })).toBeTruthy()
        await user.click(screen.getByRole('button', { name: 'Try again' }))
        expect(mocks.manager.retryInitialization).toHaveBeenCalledOnce()
    })

    it('finishes successful onboarding only after the user chooses Connect wallet', async () => {
        const user = userEvent.setup()
        mocks.state.snapshot = {
            ...emptySnapshot,
            address: savedVault.address,
            connectionPending: true,
            phase: 'onboarding-ready',
            vault: savedVault,
        }
        render(<PistachioWalletController />)
        expect(mocks.manager.finishOnboarding).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: /^Connect wallet/ }))
        expect(mocks.manager.finishOnboarding).toHaveBeenCalledWith({ continueUnlocked: true })
    })

    it('restores an encrypted backup and attempts its matching passkey unlock', async () => {
        const user = userEvent.setup()
        const backup = new File(['{"schemaVersion":1}'], 'backup.json', { type: 'application/json' })
        render(<PistachioWalletController />)
        await user.click(screen.getByRole('button', { name: /^Restore encrypted backup/ }))
        await user.upload(screen.getByLabelText('Choose encrypted backup file'), backup)

        await waitFor(() => expect(mocks.manager.restoreEncryptedBackup).toHaveBeenCalledWith('{"schemaVersion":1}'))
        expect(mocks.manager.unlock).toHaveBeenCalledOnce()
        expect(mocks.manager.close).toHaveBeenCalledOnce()
    })

    it('loads a V3 keystore through the file picker and keeps its password separate', async () => {
        const user = userEvent.setup()
        mocks.manager.beginPasskeySetup.mockImplementation(async () => mocks.publish({ phase: 'passkey-ready' }))
        render(<PistachioWalletController />)
        await openImportRisk(user, /^Keystore file/)
        await completeImportPasskeyStep(user)
        const keystore = new File(['{"version":3}'], 'wallet.json', { type: 'application/json' })
        await user.upload(await screen.findByLabelText('Choose keystore JSON file'), keystore)

        expect(await screen.findByText('wallet.json')).toBeTruthy()
        expect(screen.getByLabelText('Keystore password')).toBeTruthy()
        expect(screen.getByText(/password is not stored in the JSON file/i)).toBeTruthy()
    })

    it('associates readable mnemonic errors and clears the secret input after failure', async () => {
        const user = userEvent.setup()
        mocks.manager.beginPasskeySetup.mockImplementation(async () => mocks.publish({ phase: 'passkey-ready' }))
        mocks.manager.importMnemonic.mockRejectedValueOnce(new TypeError('The recovery phrase has invalid words or checksum.'))
        render(<PistachioWalletController />)
        await openImportRisk(user)
        await completeImportPasskeyStep(user)
        const input = screen.getByLabelText('Recovery phrase')
        await user.type(input, 'fake invalid words')
        await user.click(screen.getByRole('button', { name: 'Review imported wallet' }))

        expect((await screen.findByRole('alert')).textContent).toContain('invalid word or checksum')
        expect(input.value).toBe('')
        expect(input.getAttribute('aria-describedby')).toBe('pistachio-wallet-error')
    })

    it('shows readable private-key validation and clears the secret input', async () => {
        const user = userEvent.setup()
        mocks.manager.beginPasskeySetup.mockImplementation(async () => mocks.publish({ phase: 'passkey-ready' }))
        mocks.manager.importPrivateKey.mockRejectedValueOnce(new TypeError('Private key must be exactly 32 bytes.'))
        render(<PistachioWalletController />)
        await openImportRisk(user, /^Private key/)
        await completeImportPasskeyStep(user)
        const input = screen.getByLabelText('Private key')
        await user.type(input, '1234')
        await user.click(screen.getByRole('checkbox'))
        await user.click(screen.getByRole('button', { name: 'Review imported wallet' }))

        expect((await screen.findByRole('alert')).textContent).toContain('exactly 64 hexadecimal characters')
        expect(input.value).toBe('')
    })

    it('shows a safe keystore error and clears the file and password values', async () => {
        const user = userEvent.setup()
        mocks.manager.beginPasskeySetup.mockImplementation(async () => mocks.publish({ phase: 'passkey-ready' }))
        mocks.manager.importKeystore.mockRejectedValueOnce(new Error('low-level scrypt detail'))
        render(<PistachioWalletController />)
        await openImportRisk(user, /^Keystore file/)
        await completeImportPasskeyStep(user)
        await user.upload(screen.getByLabelText('Choose keystore JSON file'), new File(['{"version":3}'], 'wallet.json'))
        await user.type(screen.getByLabelText('Keystore password'), 'wrong-password')
        await user.click(screen.getByRole('checkbox'))
        await user.click(screen.getByRole('button', { name: 'Unlock keystore and review' }))

        expect((await screen.findByRole('alert')).textContent).toContain('Check the file and password')
        expect(screen.queryByText('low-level scrypt detail')).toBeNull()
        expect(screen.getByLabelText('Keystore password').value).toBe('')
    })
})

describe('Pistachio Wallet saved-wallet behavior', () => {
    beforeEach(resetManager)
    afterEach(cleanup)

    it('shows previous-wallet detection, shortened address, and no chooser for one vault', async () => {
        const user = userEvent.setup()
        mocks.state.snapshot = { ...savedVaultSnapshot }
        render(<PistachioWalletController />)

        expect(screen.getByRole('heading', { name: 'Previous Pistachio Wallet detected' })).toBeTruthy()
        expect(screen.getByText('Unlock a saved wallet or create and import another wallet.')).toBeTruthy()
        expect(screen.getByText('0x1111…1111')).toBeTruthy()
        expect(screen.queryByRole('button', { name: /^Choose another saved wallet/ })).toBeNull()
        await user.click(screen.getByRole('button', { name: /^Use previous wallet/ }))
        expect(mocks.manager.unlock).toHaveBeenCalledOnce()
    })

    it('opens a separate chooser only when multiple encrypted wallets exist', async () => {
        const user = userEvent.setup()
        const second = {
            address: '0x2222222222222222222222222222222222222222',
            lastUsedAt: '2026-02-01T00:00:00.000Z',
            name: 'Backup wallet with a deliberately long display name',
            sourceType: 'imported-private-key',
            vaultId: '20000000-0000-4000-8000-000000000002',
        }
        mocks.state.snapshot = { ...savedVaultSnapshot, vaults: [...savedVaultSnapshot.vaults, second] }
        render(<PistachioWalletController />)
        await user.click(screen.getByRole('button', { name: /^Choose another saved wallet/ }))

        expect(screen.getByRole('heading', { name: 'Saved Pistachio Wallets' })).toBeTruthy()
        expect(screen.getByText(second.name)).toBeTruthy()
        const secondCard = screen.getByText(second.name).closest('article')
        await user.click(within(secondCard).getByRole('button', { name: 'Unlock' }))
        expect(mocks.manager.selectVault).toHaveBeenCalledWith(second.vaultId)
        expect(mocks.manager.unlock).toHaveBeenCalledOnce()
    })

    it('opens create/import another without deleting or overwriting saved wallets', async () => {
        const user = userEvent.setup()
        mocks.state.snapshot = { ...savedVaultSnapshot }
        render(<PistachioWalletController />)
        await user.click(screen.getByRole('button', { name: /^Create or import another wallet/ }))

        expect(screen.getByRole('button', { name: /^Create a new wallet/ })).toBeTruthy()
        expect(screen.getByRole('button', { name: /^Import recovery phrase/ })).toBeTruthy()
        expect(screen.getByRole('button', { name: /^Import private key/ })).toBeTruthy()
        expect(screen.getByRole('button', { name: /^Import keystore file/ })).toBeTruthy()
        expect(screen.getByRole('button', { name: /^Restore encrypted backup/ })).toBeTruthy()
        expect(mocks.manager.deleteLocalVault).not.toHaveBeenCalled()
    })

    it('shows missing-passkey recovery, retry, and secondary remove action', async () => {
        const user = userEvent.setup()
        mocks.state.snapshot = {
            ...savedVaultSnapshot,
            error: { code: 'PISTACHIO_PASSKEY_NOT_AVAILABLE', message: 'internal detail' },
        }
        render(<PistachioWalletController />)

        expect(screen.getByText('This wallet is saved in this browser, but its passkey is unavailable.')).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
        expect(screen.getByRole('button', { name: /^Restore using recovery phrase/ })).toBeTruthy()
        expect(screen.getByRole('button', { name: /^Restore encrypted backup/ })).toBeTruthy()
        expect(screen.getByRole('button', { name: /^Import private key/ })).toBeTruthy()
        const remove = screen.getByRole('button', { name: /^Remove inaccessible wallet from this browser/ })
        expect(remove.className).toContain('secondary-danger')
        await user.click(remove)
        expect(screen.getByRole('heading', { name: 'Remove wallet from this browser' })).toBeTruthy()
    })

    it('requires backup acknowledgement and exact DELETE before local removal', async () => {
        const user = userEvent.setup()
        mocks.state.snapshot = {
            ...savedVaultSnapshot,
            error: { code: 'PISTACHIO_PASSKEY_NOT_AVAILABLE', message: 'unavailable' },
        }
        render(<PistachioWalletController />)
        await user.click(screen.getByRole('button', { name: /^Remove inaccessible wallet from this browser/ }))
        const remove = screen.getByRole('button', { name: 'Remove from this browser' })
        expect(screen.getByText(/does not delete the wallet or funds on any network/i)).toBeTruthy()
        expect(remove.disabled).toBe(true)
        await user.click(screen.getByRole('checkbox'))
        await user.type(screen.getByLabelText('Type DELETE to confirm'), 'delete')
        expect(remove.disabled).toBe(true)
        await user.clear(screen.getByLabelText('Type DELETE to confirm'))
        await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
        await user.click(remove)

        expect(mocks.manager.deleteLocalVault).toHaveBeenCalledWith(savedVault.vaultId, { backupAcknowledged: true, confirmation: 'DELETE' })
    })

    it('renames only safe wallet metadata from the saved-wallet chooser', async () => {
        const user = userEvent.setup()
        const second = { ...savedVaultSnapshot.vaults[0], address: '0x2222222222222222222222222222222222222222', name: 'Second wallet', vaultId: '20000000-0000-4000-8000-000000000002' }
        mocks.state.snapshot = { ...savedVaultSnapshot, vaults: [...savedVaultSnapshot.vaults, second] }
        render(<PistachioWalletController />)
        await user.click(screen.getByRole('button', { name: /^Choose another saved wallet/ }))
        const card = screen.getByText('Second wallet').closest('article')
        await user.click(within(card).getByRole('button', { name: 'Rename' }))
        const input = within(card).getByLabelText('Wallet name')
        await user.clear(input)
        await user.type(input, 'Trading wallet')
        await user.click(within(card).getByRole('button', { name: 'Save' }))
        expect(mocks.manager.renameSavedVault).toHaveBeenCalledWith(second.vaultId, 'Trading wallet')
    })

    it('reveals a fake recovery value only after reauthentication and supports manual lock', async () => {
        const user = userEvent.setup()
        mocks.state.snapshot = { ...savedVaultSnapshot, address: savedVault.address, phase: 'unlocked' }
        render(<PistachioWalletController />)
        expect(screen.queryByText('test-only recovery phrase')).toBeNull()
        await user.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }))
        expect(mocks.manager.revealRecoveryPhrase).toHaveBeenCalledOnce()
        expect(await screen.findByText('test-only recovery phrase')).toBeTruthy()
        await user.click(screen.getByRole('button', { name: 'Hide' }))
        expect(screen.queryByText('test-only recovery phrase')).toBeNull()
        await user.click(screen.getByRole('button', { name: 'Lock wallet' }))
        expect(mocks.manager.lock).toHaveBeenCalledWith('manual')
    })
})

describe('Pistachio Wallet signing review', () => {
    beforeEach(resetManager)
    afterEach(cleanup)

    it('shows readable MegaFuel zero-gas fields and an unknown calldata warning', async () => {
        const user = userEvent.setup()
        mocks.state.snapshot = { ...savedVaultSnapshot, address: savedVault.address, phase: 'unlocked' }
        render(<PistachioWalletController />)
        act(() => mocks.state.reviewListener({
            action: 'Sign MegaFuel transaction',
            chainId: 56,
            chainName: 'BNB Smart Chain',
            createdAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2026-01-01T00:02:00.000Z',
            id: 'review-1',
            origin: 'https://localhost.test',
            payload: {
                actionType: 'MegaFuel sponsored transaction',
                calldata: '0x12345678',
                destination: '0x2222222222222222222222222222222222222222',
                gasLimit: '100000',
                gasPrice: '0',
                submission: 'PistachioSwap will submit this signed transaction.',
                value: '0',
            },
            walletAddress: savedVault.address,
        }))

        const review = screen.getByRole('dialog', { name: 'Sign MegaFuel transaction' })
        expect(within(review).getByText('MegaFuel sponsored transaction')).toBeTruthy()
        expect(within(review).getByText('Gas price')).toBeTruthy()
        expect(within(review).getByText('This request contains contract data. Verify the destination and full transaction data before approving.')).toBeTruthy()
        expect(within(review).getByText('PistachioSwap will submit this signed transaction.')).toBeTruthy()
        await user.click(within(review).getByRole('button', { name: 'Approve' }))
        expect(mocks.manager.reviewQueue.approve).toHaveBeenCalledOnce()
    })

    it('does not approve when closing and rejects exactly once', async () => {
        const user = userEvent.setup()
        render(<PistachioWalletController />)
        act(() => mocks.state.reviewListener({
            action: 'Sign message',
            chainId: 56,
            chainName: 'BNB Smart Chain',
            expiresAt: '2026-01-01T00:02:00.000Z',
            id: 'review-2',
            origin: 'https://localhost.test',
            payload: { completeMessage: 'Deterministic fake message', purpose: 'Wallet authentication' },
            walletAddress: savedVault.address,
        }))
        const review = screen.getByRole('dialog', { name: 'Sign message' })
        await user.click(within(review).getByRole('button', { name: 'Reject signing request' }))
        expect(mocks.manager.reviewQueue.reject).toHaveBeenCalledOnce()
        expect(mocks.manager.reviewQueue.approve).not.toHaveBeenCalled()
    })
})
