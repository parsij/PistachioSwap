import { describe, expect, it, vi } from 'vitest'

import { PistachioWalletManager } from './walletManager.js'

const vault = {
    vaultId: '10000000-0000-4000-8000-000000000001',
    name: 'Pistachio Wallet',
    address: '0x0000000000000000000000000000000000000001',
    sourceType: 'generated-mnemonic',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    keyWraps: [{ id: 'wrap-1' }],
}

function createWindow() {
    return {
        addEventListener: vi.fn(),
        clearTimeout: vi.fn(),
        document: { addEventListener: vi.fn(), visibilityState: 'visible' },
        setTimeout: vi.fn(() => 1),
    }
}

describe('Pistachio Wallet bootstrap storage', () => {
    it('hydrates startup state from the batched storage snapshot when available', async () => {
        const readWalletBootstrapState = vi.fn(async () => ({
            vaults: [vault],
            activeVault: vault,
            preferences: {
                activeVaultId: vault.vaultId,
                vaultPreferences: {
                    [vault.vaultId]: {
                        label: 'Fast Wallet',
                        lastUsedAt: '2026-09-08T18:00:00.000Z',
                    },
                },
                lastUnlockByWrap: { 'wrap-1': '2026-09-08T18:00:00.000Z' },
                recoveryBackupConfirmed: true,
                activeSessionVaultId: vault.vaultId,
                lastWalletActivityAt: null,
                sessionResumeEligible: false,
            },
        }))
        const storage = {
            readWalletBootstrapState,
            listVaults: vi.fn(async () => { throw new Error('legacy list should not run') }),
            readActiveVault: vi.fn(async () => { throw new Error('legacy active read should not run') }),
            readPreference: vi.fn(async () => { throw new Error('legacy preference read should not run') }),
            selectActiveVault: vi.fn(async () => vault),
            writePreference: vi.fn(async () => undefined),
        }
        const manager = new PistachioWalletManager({ storage, windowImpl: createWindow() })
        manager.flags = { ...manager.flags, autoLockMinutes: 15, passkeyWalletEnabled: true }

        await manager.initialize()

        expect(readWalletBootstrapState).toHaveBeenCalledOnce()
        expect(storage.listVaults).not.toHaveBeenCalled()
        expect(storage.readActiveVault).not.toHaveBeenCalled()
        expect(storage.readPreference).not.toHaveBeenCalled()
        expect(manager.snapshot()).toMatchObject({
            phase: 'locked',
            selectedVaultId: vault.vaultId,
            sessionActive: true,
            recoveryBackupConfirmed: true,
            vaults: [{ name: 'Fast Wallet' }],
        })
    })
})
