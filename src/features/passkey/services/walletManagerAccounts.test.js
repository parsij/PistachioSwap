import { describe, expect, it, vi } from 'vitest'
import { PistachioWalletManager } from './walletManager.js'
vi.mock('./passkeyService.js', () => ({ getPrfForVaultWrap: vi.fn(async () => new Uint8Array(32).fill(7)), registerPrfPasskey: vi.fn() }))
import { pistachioConnectorInternals } from './pistachioConnector.js'
const root = '0x0000000000000000000000000000000000000001'
const second = '0x0000000000000000000000000000000000000002'
const third = '0x0000000000000000000000000000000000000003'
const vault = { vaultId: 'seed', address: root, name: 'Seed', sourceType: 'imported-mnemonic', keyWraps: [{ id: 'wrap' }], accounts: [{ index: 0, address: root }, { index: 1, address: second }] }
function harness() {
    let stored = structuredClone(vault)
    const preferences = { activeSessionVaultId: 'seed' }
    const storage = {
        listVaults: vi.fn(async () => [stored]), readActiveVault: vi.fn(async () => stored),
        readPreference: vi.fn(async (key) => preferences[key]),
        writePreference: vi.fn(async (key, value) => { preferences[key] = structuredClone(value) }),
        selectActiveVault: vi.fn(async () => stored),
        saveAndReadBackVault: vi.fn(async (candidate) => { stored = structuredClone(candidate); return stored }),
    }
    const manager = new PistachioWalletManager({ storage, windowImpl: null })
    manager.flags = { ...manager.flags, passkeyWalletEnabled: true }
    return { manager, storage, preferences }
}
async function unlockedHarness() {
    const h = harness()
    await h.manager.initialize()
    h.manager.phase = 'unlocked'; h.manager.address = root
    h.manager.client = { lock: vi.fn(), request: vi.fn(async (operation) => operation === 'createDerivedAccount' ? { vault: { ...vault, accounts: [...vault.accounts, { index: 2, address: third }] }, index: 2, address: third } : { address: third }) }
    h.manager.reauthenticate = vi.fn(async () => true)
    return h
}
describe('derived account manager lifecycle', () => {
    it('switches a locked session once, emits the selected address and persists selection across reload', async () => {
        const { manager, storage } = harness()
        await manager.initialize()
        const provider = pistachioConnectorInternals.createProvider(manager)
        const changed = vi.fn(); const disconnected = vi.fn()
        provider.on('accountsChanged', changed); provider.on('disconnect', disconnected)
        await manager.selectAccount('seed', 1)
        expect(manager.snapshot()).toMatchObject({ selectedAddress: second, selectedAccountIndex: 1, phase: 'locked', sessionActive: true, address: null })
        expect(changed.mock.calls).toEqual([[[second]]])
        expect(disconnected).not.toHaveBeenCalled()
        expect(await manager.providerRequest({ method: 'eth_accounts' })).toEqual([second])
        const reloaded = new PistachioWalletManager({ storage, windowImpl: null })
        reloaded.flags = { ...reloaded.flags, passkeyWalletEnabled: true }
        await reloaded.initialize()
        expect(reloaded.snapshot().selectedAddress).toBe(second)
        expect(await reloaded.providerRequest({ method: 'eth_accounts' })).toEqual([second])
    })
    it('invalidates queued reviews and old signing context before publishing a new account', async () => {
        const { manager } = await unlockedHarness()
        const context = manager.captureSigningContext()
        const review = manager.reviewQueue.request({ walletAddress: root, chainId: 56, action: 'Test' })
        const rejected = expect(review).rejects.toMatchObject({ code: 'PISTACHIO_SIGNING_CONTEXT_CHANGED' })
        const oldClient = manager.client
        await manager.selectAccount('seed', 1)
        await rejected
        expect(oldClient.lock).toHaveBeenCalledOnce()
        expect(manager.client).toBeNull()
        expect(() => manager.assertSigningContext(context)).toThrow()
        expect(manager.interactionGeneration).toBe(1)
    })
    it('keeps selection and provider account unchanged when saving selection fails', async () => {
        const { manager, storage } = await unlockedHarness()
        storage.writePreference.mockImplementation(async (key) => { if (key === 'selectedAccountIndices') throw new Error('disk full') })
        await expect(manager.selectAccount('seed', 1)).rejects.toThrow('disk full')
        expect(manager.selectedAccountAddress()).toBe(root)
        expect(await manager.providerRequest({ method: 'eth_accounts' })).toEqual([root])
        expect(manager.accountChangePending).toBe(false)
    })
    it('persists and verifies a new account before publishing or switching the signer', async () => {
        const { manager, storage, preferences } = await unlockedHarness()
        const client = manager.client
        expect(await manager.createAccount()).toBe(third)
        expect(client.request.mock.calls.map(([operation]) => operation)).toEqual(['createDerivedAccount', 'adoptDerivedAccounts'])
        expect(storage.saveAndReadBackVault.mock.invocationCallOrder[0]).toBeLessThan(client.request.mock.invocationCallOrder[1])
        expect(preferences.selectedAccountIndices.seed).toBe(2)
        expect(manager.snapshot()).toMatchObject({ address: third, selectedAddress: third, selectedAccountIndex: 2 })
    })
    it('does not adopt an account or advance the sequence when the vault write fails', async () => {
        const { manager, storage } = await unlockedHarness()
        const client = manager.client
        storage.saveAndReadBackVault.mockRejectedValueOnce(new Error('quota exceeded'))
        await expect(manager.createAccount()).rejects.toThrow('quota exceeded')
        expect(client.request).toHaveBeenCalledOnce()
        expect(manager.vault.accounts).toHaveLength(2)
        expect(manager.selectedAccountAddress()).toBe(root)
        expect(manager.client).toBeNull()
        expect(manager.accountChangePending).toBe(false)
    })
    it('rejects concurrent creation/selection and nonexistent indices', async () => {
        const { manager } = await unlockedHarness()
        let resume
        manager.reauthenticate = vi.fn(() => new Promise((resolve) => { resume = resolve }))
        const creating = manager.createAccount()
        await expect(manager.createAccount()).rejects.toMatchObject({ code: 'PISTACHIO_ACCOUNT_CHANGE_ACTIVE' })
        await expect(manager.selectAccount('seed', 1)).rejects.toMatchObject({ code: 'PISTACHIO_ACCOUNT_CHANGE_ACTIVE' })
        resume(); await creating
        await expect(manager.selectAccount('seed', 99)).rejects.toThrow('does not exist')
    })
    it('passes the selected index to passkey unlock instead of reverting to the seed root', async () => {
        const { manager } = harness()
        await manager.initialize()
        await manager.selectAccount('seed', 1)
        const client = { transferPrf: vi.fn(async (_operation, _payload, prf) => {
            structuredClone(prf, { transfer: [prf.buffer] })
            return { address: second }
        }), terminate: vi.fn() }
        manager.freshClient = () => { manager.client = client; return client }
        expect(await manager.unlock()).toBe(second)
        expect(client.transferPrf).toHaveBeenCalledWith('unlockVault', expect.objectContaining({ accountIndex: 1 }), expect.any(Uint8Array))
        expect(manager.snapshot().address).toBe(second)
    })
    it('rejects a late unlock result after another account was selected', async () => {
        const { manager } = harness()
        await manager.initialize()
        await manager.selectAccount('seed', 1)
        let complete
        const client = { transferPrf: vi.fn((_operation, _payload, prf) => {
            structuredClone(prf, { transfer: [prf.buffer] })
            return new Promise((resolve) => { complete = resolve })
        }), lock: vi.fn(), terminate: vi.fn() }
        manager.freshClient = () => { manager.client = client; return client }
        const unlocking = manager.unlock()
        const rejected = expect(unlocking).rejects.toMatchObject({ code: 'PISTACHIO_CONNECTION_CANCELLED' })
        await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
        await manager.selectAccount('seed', 0)
        complete({ address: second })
        await rejected
        expect(manager.snapshot()).toMatchObject({ phase: 'locked', address: null, selectedAddress: root })
        expect(await manager.providerRequest({ method: 'eth_accounts' })).toEqual([root])
    })
    it('falls back to root for stale selection preferences and original single-account vaults', async () => {
        const { manager, preferences } = harness()
        preferences.selectedAccountIndices = { seed: 99 }
        await manager.initialize()
        expect(manager.selectedAccountAddress()).toBe(root)
        manager.vault = { ...vault, accounts: undefined }
        expect(manager.selectedAccountAddress()).toBe(root)
    })
})
