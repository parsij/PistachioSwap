import { describe, expect, it, vi } from 'vitest'
import { getPrfForVaultWrap } from './passkeyService.js'
import { PistachioWalletManager } from './walletManager.js'

vi.mock('./passkeyService.js', () => ({
    getPrfForVaultWrap: vi.fn(),
    registerPrfPasskey: vi.fn(),
}))

const savedVault = {
    vaultId: '10000000-0000-4000-8000-000000000001',
    name: 'Test wallet',
    address: '0x0000000000000000000000000000000000000001',
    sourceType: 'generated-mnemonic',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    keyWraps: [{ id: 'wrap-1' }],
}

async function createHarness() {
    const storage = {
        deleteVault: vi.fn(),
        listVaults: vi.fn(async () => [savedVault]),
        readActiveVault: vi.fn(async () => savedVault),
        readPreference: vi.fn(async () => null),
        saveAndReadBackVault: vi.fn(),
        writePreference: vi.fn(async () => undefined),
    }
    const manager = new PistachioWalletManager({ storage, windowImpl: null })
    manager.flags = { ...manager.flags, passkeyWalletEnabled: true, walletImportEnabled: true }
    await manager.initialize()
    return { manager, storage }
}

describe('wallet import and passkey failure recovery', () => {
    it.each([
        ['importMnemonic', 'mnemonic'],
        ['importPrivateKey', 'privateKey'],
    ])('keeps the same passkey setup and saved vaults after a failed %s request', async (operation, field) => {
        const { manager, storage } = await createHarness()
        await manager.prepareNewWallet()
        const request = vi.fn()
            .mockRejectedValueOnce(new TypeError('Invalid test-only import.'))
            .mockResolvedValueOnce({ address: savedVault.address })
        const client = { request, terminate: vi.fn(), lock: vi.fn() }
        manager.client = client
        manager.phase = 'passkey-ready'

        await expect(manager[operation]('test-only-invalid-input')).rejects.toThrow('Invalid test-only import.')
        expect(manager.phase).toBe('passkey-ready')
        expect(manager.client).toBe(client)
        expect(client.terminate).not.toHaveBeenCalled()
        expect(client.lock).not.toHaveBeenCalled()
        expect(storage.deleteVault).not.toHaveBeenCalled()
        expect(storage.saveAndReadBackVault).not.toHaveBeenCalled()

        await expect(manager[operation]('test-only-corrected-input')).resolves.toEqual({ address: savedVault.address })
        expect(request).toHaveBeenLastCalledWith(operation, { [field]: 'test-only-corrected-input' })
        expect(manager.phase).toBe('confirm-import')
    })

    it('keeps the encrypted wallet and its passkeys when the selected passkey cannot unlock it', async () => {
        const { manager, storage } = await createHarness()
        const prfOutput = new Uint8Array(32).fill(42).buffer
        vi.mocked(getPrfForVaultWrap).mockResolvedValueOnce(prfOutput)
        const client = {
            transferPrf: vi.fn().mockRejectedValueOnce(new Error('Test-only mismatched passkey.')),
            terminate: vi.fn(),
        }
        manager.freshClient = vi.fn(() => { manager.client = client; return client })

        await expect(manager.unlock('wrap-1')).rejects.toMatchObject({ code: 'PISTACHIO_WALLET_UNLOCK_FAILED' })
        expect(manager.phase).toBe('locked')
        expect(manager.vault).toEqual(savedVault)
        expect(manager.vault.keyWraps).toEqual([{ id: 'wrap-1' }])
        expect(storage.deleteVault).not.toHaveBeenCalled()
        expect(storage.saveAndReadBackVault).not.toHaveBeenCalled()
        expect(client.terminate).toHaveBeenCalledOnce()
        expect([...new Uint8Array(prfOutput)]).toEqual(Array(32).fill(0))
    })
})

describe('imported account selection persistence', () => {
    it('saves the selected account index and publishes that address after verification', async () => {
        const { manager, storage } = await createHarness()
        await manager.prepareNewWallet()
        const second = '0x0000000000000000000000000000000000000002'
        const stored = { ...savedVault, accounts: [{ index: 0, address: savedVault.address }, { index: 1, address: second }] }
        manager.pendingVaultId = stored.vaultId
        manager.phase = 'confirm-import'
        manager.client = { request: vi.fn(async (operation) => {
            if (operation === 'selectPendingAccount') return { index: 1, address: second }
            if (operation === 'encryptVault') return { vault: stored }
            if (operation === 'verifyPersistedVault') return { address: second, verified: true }
        }), lock: vi.fn() }
        storage.saveAndReadBackVault.mockResolvedValue(stored)
        storage.listVaults.mockResolvedValue([stored])
        await manager.selectPendingAccount(1)
        await manager.persistPendingWallet()
        expect(storage.writePreference).toHaveBeenCalledWith('selectedAccountIndices', { [stored.vaultId]: 1 })
        expect(manager.snapshot()).toMatchObject({ phase: 'onboarding-ready', address: second, selectedAddress: second, selectedAccountIndex: 1 })
    })
})
