// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    revealPrivateKey: vi.fn(),
    revealRecoveryPhrase: vi.fn(),
    addBackupPasskey: vi.fn(),
    removePasskey: vi.fn(),
    renamePasskey: vi.fn(),
    reauthenticate: vi.fn(),
}))

vi.mock('../../services/walletUIOperations.js', () => ({
    walletUIOperations: {
        addBackupPasskey: mocks.addBackupPasskey,
        confirmRecoveryBackup: vi.fn(),
        exportEncryptedBackup: vi.fn(),
        exportKeystore: vi.fn(),
        lock: vi.fn(),
        reauthenticate: mocks.reauthenticate,
        removePasskey: mocks.removePasskey,
        renamePasskey: mocks.renamePasskey,
        revealPrivateKey: mocks.revealPrivateKey,
        revealRecoveryPhrase: mocks.revealRecoveryPhrase,
    },
}))

import { UnlockedContent } from './UnlockedWalletScreen.jsx'

const phrase = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'
const privateKey = `0x${'ab'.repeat(32)}`

function snapshot({ sourceType = 'generated-mnemonic' } = {}) {
    return {
        address: '0x1111111111111111111111111111111111111111',
        lastUnlockByWrap: {},
        phase: 'unlocked',
        recoveryBackupConfirmed: true,
        vault: {
            address: '0x1111111111111111111111111111111111111111',
            keyWraps: [{
                createdAt: '2026-08-10T00:00:00.000Z',
                credentialTransports: [],
                id: 'wrap-1',
                label: 'Primary passkey',
                rpId: 'pistachioswap.com',
            }],
            sourceType,
        },
    }
}

describe('wallet secret reveal UI', () => {
    afterEach(() => { cleanup(); vi.useRealTimers() })
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.revealPrivateKey.mockReset()
        mocks.revealPrivateKey.mockResolvedValue(privateKey)
        mocks.revealRecoveryPhrase.mockReset()
        mocks.revealRecoveryPhrase.mockResolvedValue(phrase)
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: vi.fn().mockResolvedValue(undefined) },
        })
    })

    it('navigates tabs with the keyboard and clears a revealed secret when leaving Recovery', async () => {
        const user = userEvent.setup()
        render(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={snapshot()} />)
        screen.getByRole('tab', { name: 'Passkeys' }).focus()
        await user.keyboard('{ArrowRight}')
        expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Recovery' }))
        await user.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }))
        await screen.findByRole('region', { name: 'Recovery phrase' })
        await user.click(screen.getByRole('tab', { name: 'Overview' }))
        expect(screen.queryByText('alpha')).toBeNull()
        await user.click(screen.getByRole('tab', { name: 'Recovery' }))
        expect(screen.queryByRole('region', { name: 'Recovery phrase' })).toBeNull()
    })

    it('keeps the active recovery panel stable and prevents another action during verification', async () => {
        let complete
        mocks.revealRecoveryPhrase.mockReturnValueOnce(new Promise((resolve) => { complete = resolve }))
        const view = render(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={snapshot()} />)
        fireEvent.click(screen.getByRole('tab', { name: 'Recovery' }))
        fireEvent.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }))
        view.rerender(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={{ ...snapshot(), phase: 'unlocking', address: null }} />)
        expect(screen.getByRole('tab', { name: 'Recovery' }).getAttribute('aria-selected')).toBe('true')
        expect(screen.getByRole('tab', { name: 'Passkeys' }).disabled).toBe(true)
        expect(screen.getByRole('button', { name: 'Done' }).disabled).toBe(true)
        await act(async () => complete(phrase))
        expect(screen.getByRole('region', { name: 'Recovery phrase' })).toBeTruthy()
    })

    it('continues to hide recovery material automatically after sixty seconds', async () => {
        vi.useFakeTimers()
        render(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={snapshot()} />)
        fireEvent.click(screen.getByRole('tab', { name: 'Recovery' }))
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reveal recovery phrase' })))
        expect(screen.getByRole('region', { name: 'Recovery phrase' })).toBeTruthy()
        act(() => vi.advanceTimersByTime(60_000))
        expect(screen.queryByText('alpha')).toBeNull()
    })

    it('renames a passkey explicitly and passes the entered backup name to the wallet service', async () => {
        const user = userEvent.setup()
        render(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={snapshot()} />)
        await user.click(screen.getByRole('button', { name: 'Rename Primary passkey' }))
        const field = screen.getByLabelText('Passkey label')
        await user.clear(field)
        await user.type(field, 'My laptop')
        expect(mocks.renamePasskey).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: 'Save label for Primary passkey' }))
        expect(mocks.renamePasskey).toHaveBeenCalledWith('wrap-1', 'My laptop')
        expect(screen.queryByLabelText('Passkey label')).toBeNull()
        await user.click(screen.getByRole('button', { name: 'Add passkey' }))
        expect(mocks.addBackupPasskey).toHaveBeenCalledWith('Backup passkey')
    })

    it('requires another passkey and explicit confirmation before removing access', async () => {
        const user = userEvent.setup()
        const initial = snapshot()
        const singleView = render(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={initial} />)
        await user.click(screen.getByRole('button', { name: 'Details for Primary passkey' }))
        expect(screen.getByRole('button', { name: 'Remove Primary passkey' }).disabled).toBe(true)
        singleView.unmount()

        const multiple = {
            ...initial,
            recoveryBackupConfirmed: false,
            vault: {
                ...initial.vault,
                keyWraps: [
                    ...initial.vault.keyWraps,
                    { ...initial.vault.keyWraps[0], id: 'wrap-2', label: 'Backup passkey' },
                ],
            },
        }
        render(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={multiple} />)
        await user.click(screen.getByRole('button', { name: 'Details for Primary passkey' }))

        const primaryCard = screen.getByRole('article', { name: 'Primary passkey' })
        const removeButton = within(primaryCard).getByRole('button', { name: 'Remove Primary passkey' })
        expect(removeButton.disabled).toBe(false)
        expect(within(primaryCard).getByText('Another passkey will remain after removal. Keep an offline recovery backup too.')).toBeTruthy()
        await user.click(removeButton)
        expect(mocks.removePasskey).not.toHaveBeenCalled()
        const confirmation = within(primaryCard).getByRole('group', { name: 'Confirm removal of Primary passkey' })
        await user.click(within(confirmation).getByRole('button', { name: 'Remove passkey' }))
        expect(mocks.removePasskey).toHaveBeenCalledWith('wrap-1')
    })

    it('reports successful passkey testing and routes Done through the controller close guard', async () => {
        const user = userEvent.setup()
        const onClose = vi.fn()
        render(<UnlockedContent onClose={onClose} onSensitiveChange={vi.fn()} snapshot={snapshot()} />)
        const backupHint = screen.getByText('Keep an offline recovery backup before removing a passkey.').parentElement
        const testButton = screen.getByRole('button', { name: 'Test passkey unlock' })
        expect(backupHint.compareDocumentPosition(testButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        await user.click(testButton)
        expect(mocks.reauthenticate).toHaveBeenCalledOnce()
        expect(await screen.findByText('Passkey verified. This wallet can be unlocked with it.')).toBeTruthy()
        await user.click(screen.getByRole('button', { name: 'Done' }))
        expect(onClose).toHaveBeenCalledOnce()
    })

    it('shows all twelve words numbered 1 through 12 and copies them as one phrase', async () => {
        render(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={snapshot()} />)
        fireEvent.click(screen.getByRole('tab', { name: 'Recovery' }))
        fireEvent.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }))

        const region = await screen.findByRole('region', { name: 'Recovery phrase' })
        const words = within(region).getAllByRole('listitem')

        expect(words).toHaveLength(12)
        expect(words[0]?.textContent).toContain('1.')
        expect(words[0]?.textContent).toContain('alpha')
        expect(words[11]?.textContent).toContain('12.')
        expect(words[11]?.textContent).toContain('lima')

        fireEvent.click(within(region).getByRole('button', { name: 'Copy recovery phrase' }))
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(phrase)
        await within(region).findByRole('button', { name: 'Copied' })
    })

    it('shows a copy button for a revealed private key and copies the exact key', async () => {
        render(
            <UnlockedContent
                onSensitiveChange={vi.fn()}
                snapshot={snapshot({ sourceType: 'imported-private-key' })}
            />,
        )

        fireEvent.click(screen.getByRole('tab', { name: 'Recovery' }))
        fireEvent.click(screen.getByRole('button', { name: 'Reveal private key' }))

        const region = await screen.findByRole('region', { name: 'Private key' })
        expect(within(region).getByText(privateKey)).toBeTruthy()

        fireEvent.click(within(region).getByRole('button', { name: 'Copy private key' }))
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(privateKey)
        await within(region).findByRole('button', { name: 'Copied' })
    })
})
