import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { bytesToBase64Url } from './passkeyEncoding.js'
import { createEncryptedVault } from './vaultCrypto.js'
import { PistachioWalletManager } from './walletManager.js'
import {
    deleteVault,
    listVaults,
    readActiveVault,
    readPreference,
    readVault,
    saveAndReadBackVault,
    selectActiveVault,
    writePreference,
} from './vaultStorage.js'

let indexedDb

async function fixture({ vaultId = '10000000-0000-4000-8000-000000000001', address = '0x000000000000000000000000000000000000dEaD' } = {}) {
    return (await createEncryptedVault({
        vaultId,
        address,
        rpId: 'localhost',
        sourceType: 'imported-private-key',
        derivationPath: null,
        payload: { kind: 'private-key', privateKey: bytesToBase64Url(new Uint8Array(32).fill(4)), sourceType: 'imported-private-key' },
        keyWrap: {
            id: '10000000-0000-4000-8000-000000000002',
            credentialId: 'AQ', credentialTransports: [], rpId: 'localhost',
            prfInput: bytesToBase64Url(new Uint8Array(32).fill(2)),
            hkdfSalt: bytesToBase64Url(new Uint8Array(32).fill(3)),
            wrapIv: null, wrappedDek: null, label: 'Primary',
            createdAt: '2026-01-01T00:00:00.000Z', prfVerified: true,
        },
        prfOutput: new Uint8Array(32).fill(5),
        now: '2026-01-01T00:00:00.000Z',
    })).vault
}

describe('Pistachio IndexedDB vault storage', () => {
    beforeEach(() => { indexedDb = new IDBFactory() })

    it('atomically stores, reads back, and validates the active encrypted vault', async () => {
        const vault = await fixture()
        expect(await saveAndReadBackVault(vault, indexedDb)).toEqual(vault)
        expect(await readActiveVault(indexedDb)).toEqual(vault)
        const serialized = JSON.stringify(await readActiveVault(indexedDb))
        expect(serialized).not.toContain('mnemonic')
        expect(serialized).not.toContain('privateKey')
        expect(serialized).not.toContain('prfOutput')
    })

    it('rejects corrupted and future-schema records', async () => {
        const vault = await fixture()
        await expect(saveAndReadBackVault({ ...vault, schemaVersion: 2 }, indexedDb)).rejects.toThrow('Unsupported')
        await expect(saveAndReadBackVault({ ...vault, encryptedPayload: { ...vault.encryptedPayload, iv: 'bad*' } }, indexedDb)).rejects.toThrow('Invalid')
    })

    it('fails closed when IndexedDB is unavailable', async () => {
        await expect(readActiveVault(null)).rejects.toMatchObject({ code: 'PISTACHIO_WALLET_STORAGE_FAILED' })
    })

    it('stores, selects, and deletes independent encrypted vaults by vaultId', async () => {
        const first = await fixture()
        const second = await fixture({
            vaultId: '20000000-0000-4000-8000-000000000002',
            address: '0x0000000000000000000000000000000000000001',
        })
        await saveAndReadBackVault(first, indexedDb)
        await saveAndReadBackVault(second, indexedDb)

        expect((await listVaults(indexedDb)).map((vault) => vault.vaultId).sort()).toEqual([first.vaultId, second.vaultId].sort())
        expect((await selectActiveVault(first.vaultId, indexedDb)).address).toBe(first.address)
        expect((await readActiveVault(indexedDb)).vaultId).toBe(first.vaultId)

        expect(await deleteVault(first.vaultId, indexedDb)).toBe(true)
        expect((await listVaults(indexedDb)).map((vault) => vault.vaultId)).toEqual([second.vaultId])
        expect(await readActiveVault(indexedDb)).toBeNull()
        expect(await selectActiveVault(second.vaultId, indexedDb)).toEqual(second)
    })

    it('preserves the actual IndexedDB vault when the connector lifecycle disconnects', async () => {
        const vault = await fixture()
        await saveAndReadBackVault(vault, indexedDb)
        const storage = {
            deleteVault: (vaultId) => deleteVault(vaultId, indexedDb),
            listVaults: () => listVaults(indexedDb),
            readActiveVault: () => readActiveVault(indexedDb),
            readPreference: (key) => readPreference(key, indexedDb),
            readVault: (vaultId) => readVault(vaultId, indexedDb),
            saveAndReadBackVault: (nextVault) => saveAndReadBackVault(nextVault, indexedDb),
            selectActiveVault: (vaultId) => selectActiveVault(vaultId, indexedDb),
            writePreference: (key, value) => writePreference(key, value, indexedDb),
        }
        const windowImpl = {
            addEventListener() {},
            clearTimeout() {},
            document: { addEventListener() {}, visibilityState: 'visible' },
            setTimeout() { return 1 },
        }
        const manager = new PistachioWalletManager({ storage, windowImpl })
        manager.flags = { ...manager.flags, autoLockMinutes: 15, passkeyWalletEnabled: true }
        await manager.initialize()
        manager.client = { lock: async () => undefined }
        manager.phase = 'unlocked'
        manager.address = vault.address

        await manager.disconnect()

        expect(await readActiveVault(indexedDb)).toEqual(vault)
        expect(await listVaults(indexedDb)).toEqual([vault])
        expect(manager.phase).toBe('locked')
        expect(manager.client).toBeNull()
    })
})
