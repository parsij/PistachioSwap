// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WalletAccountPicker from './WalletAccountPicker.jsx'
vi.mock('../../services/walletManager.js', () => ({ getPistachioWalletManager: vi.fn() }))
vi.mock('../../../wallet/components/wallet/WalletAccountButton.jsx', () => ({ WalletAvatar: ({ address }) => <span data-testid="avatar">{address}</span> }))
const root = '0x0000000000000000000000000000000000000001'
const second = '0x0000000000000000000000000000000000000002'
function harness(sourceType = 'imported-mnemonic') {
    let snapshot = { selectedVaultId: 'seed', selectedAccountIndex: 0, vaults: [{ vaultId: 'seed', name: 'Pistachio Wallet', sourceType, address: root, accounts: [{ index: 0, address: root }, { index: 1, address: second }] }] }
    let publish
    const manager = { snapshot: () => snapshot, subscribe: (listener) => { publish = listener; listener(snapshot); return () => {} }, initialize: vi.fn(async () => {}), selectAccount: vi.fn(async (_vaultId, index) => { snapshot = { ...snapshot, selectedAccountIndex: index }; publish(snapshot) }), createAccount: vi.fn(async () => {}), prepareNewWallet: vi.fn(async () => {}), open: vi.fn() }
    render(<WalletAccountPicker manager={manager} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch wallet' }))
    return manager
}
afterEach(cleanup)
describe('wallet account picker', () => {
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
