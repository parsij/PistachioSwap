// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor, cleanup, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WalletAccountPicker from './WalletAccountPicker.jsx'
vi.mock('../../services/walletManager.js', () => ({ getPistachioWalletManager: vi.fn() }))
vi.mock('../../../wallet/components/wallet/WalletAccountButton.jsx', () => ({ WalletAvatar: ({ address }) => <span data-testid="avatar">{address}</span> }))
const root = '0x0000000000000000000000000000000000000001'
const second = '0x0000000000000000000000000000000000000002'
function harness(sourceType = 'imported-mnemonic') {
    let snapshot = { selectedVaultId: 'seed', selectedAccountIndex: 0, vaults: [{ vaultId: 'seed', name: 'Pistachio Wallet', sourceType, address: root, accounts: [{ index: 0, address: root }, { index: 1, address: second }] }] }
    let publish
    const manager = { snapshot: () => snapshot, subscribe: (listener) => { publish = listener; listener(snapshot); return () => {} }, initialize: vi.fn(async () => {}), selectAccount: vi.fn(async (_vaultId, index) => { snapshot = { ...snapshot, selectedAccountIndex: index }; publish(snapshot) }), createAccount: vi.fn(async () => {}), prepareNewWallet: vi.fn(async () => {}), open: vi.fn(), deleteLocalVault: vi.fn(async () => {}) }
    render(<WalletAccountPicker manager={manager} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch wallet' }))
    return manager
}
afterEach(() => { cleanup(); vi.useRealTimers() })
describe('wallet account picker', () => {
    it('requires a full ten seconds, a backup acknowledgement before removing the selected group', async () => {
        vi.useFakeTimers()
        const manager = harness()
        fireEvent.click(screen.getByRole('button', { name: /Remove Pistachio Wallet/ }))
        expect(screen.getByRole('alertdialog')).toBeTruthy()
        expect(screen.getByText(/All 2 wallets/)).toBeTruthy()
        expect(screen.getByText(/passkey alone cannot restore/)).toBeTruthy()
        fireEvent.click(screen.getByRole('checkbox'))
        await act(async () => { vi.advanceTimersByTime(9999) })
        expect(screen.getByRole('button', { name: /Remove wallet/ }).disabled).toBe(true)
        expect(manager.deleteLocalVault).not.toHaveBeenCalled()
        await act(async () => { vi.advanceTimersByTime(1) })
        expect(screen.getByRole('button', { name: 'Remove wallet' }).disabled).toBe(false)
        expect(screen.queryByRole('textbox')).toBeNull()
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove wallet' })) })
        expect(manager.deleteLocalVault).toHaveBeenCalledWith('seed', { backupAcknowledged: true, confirmation: 'DELETE' })
        expect(screen.getByRole('dialog')).toBeTruthy()
    })
    it('cancels without deletion and restarts the countdown and acknowledgements on reopening', async () => {
        vi.useFakeTimers()
        const manager = harness()
        fireEvent.click(screen.getByRole('button', { name: /Remove Pistachio Wallet/ }))
        await act(async () => { vi.advanceTimersByTime(10000) })
        expect(screen.getByRole('button', { name: 'Remove wallet' }).disabled).toBe(true)
        fireEvent.click(screen.getByRole('checkbox'))
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        expect(manager.deleteLocalVault).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: /Remove Pistachio Wallet/ }))
        expect(screen.getByRole('button', { name: 'Remove wallet (10s)' }).disabled).toBe(true)
        expect(screen.getByRole('checkbox').checked).toBe(false)
    })
    it('keeps the warning visible if storage deletion fails', async () => {
        vi.useFakeTimers()
        const manager = harness()
        manager.deleteLocalVault.mockRejectedValueOnce(new Error('Storage unavailable.'))
        fireEvent.click(screen.getByRole('button', { name: /Remove Pistachio Wallet/ }))
        fireEvent.click(screen.getByRole('checkbox'))
        await act(async () => { vi.advanceTimersByTime(10000) })
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove wallet' })) })
        expect(screen.getByRole('alert').textContent).toContain('Storage unavailable')
        expect(screen.getByRole('alertdialog')).toBeTruthy()
    })
    it('lists wallet names/addresses, highlights the active account and switches by vault and index', async () => {
        const manager = harness()
        const selected = screen.getByRole('button', { name: /Wallet 1.*Selected wallet/ })
        expect(selected.getAttribute('aria-pressed')).toBe('true')
        fireEvent.click(screen.getByRole('button', { name: /Wallet 2/ }))
        await waitFor(() => expect(manager.selectAccount).toHaveBeenCalledWith('seed', 1))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        expect(screen.getByRole('button', { name: 'Switch wallet' }).textContent).toContain('Wallet 2')
    })
    it('creates a wallet with a protected manager action and closes after success', async () => {
        const manager = harness()
        fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }))
        await waitFor(() => expect(manager.createAccount).toHaveBeenCalledOnce())
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    })
    it('keeps the picker open and shows failed passkey/save errors without deleting accounts', async () => {
        const manager = harness()
        manager.createAccount.mockRejectedValueOnce(new Error('Passkey verification was cancelled.'))
        fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }))
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('cancelled'))
        expect(screen.getByRole('dialog')).toBeTruthy()
        expect(screen.getByRole('button', { name: /Wallet 2/ })).toBeTruthy()
    })
    it('disables derived creation for private-key imports while allowing a new seed/import', async () => {
        const manager = harness('imported-private-key')
        expect(screen.getByRole('button', { name: 'Create wallet' }).disabled).toBe(true)
        fireEvent.click(screen.getByRole('button', { name: 'Add or import another wallet' }))
        await waitFor(() => expect(manager.prepareNewWallet).toHaveBeenCalledOnce())
        expect(manager.open).toHaveBeenCalledWith('wallet')
    })
})
