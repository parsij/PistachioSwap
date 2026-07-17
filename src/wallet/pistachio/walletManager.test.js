import { Wallet, keccak256, toUtf8Bytes } from 'ethers'
import { describe, expect, it, vi } from 'vitest'

import { PistachioWalletManager, walletManagerInternals } from './walletManager.js'

const firstVault = {
    vaultId: '10000000-0000-4000-8000-000000000001',
    name: 'Pistachio Wallet',
    address: '0x0000000000000000000000000000000000000001',
    sourceType: 'generated-mnemonic',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    keyWraps: [{ id: 'wrap-1' }],
}

const secondVault = {
    ...firstVault,
    vaultId: '20000000-0000-4000-8000-000000000002',
    address: '0x0000000000000000000000000000000000000002',
    sourceType: 'imported-private-key',
    keyWraps: [{ id: 'wrap-2' }],
}

function createWindow() {
    return {
        addEventListener: vi.fn(),
        clearTimeout: vi.fn(),
        document: { addEventListener: vi.fn(), visibilityState: 'visible' },
        setTimeout: vi.fn(() => 1),
    }
}

function createHarness(initialVaults = [firstVault], activeVault = firstVault, windowImpl = createWindow()) {
    let vaults = [...initialVaults]
    let active = activeVault
    const storage = {
        deleteVault: vi.fn(async (vaultId) => {
            const existed = vaults.some((vault) => vault.vaultId === vaultId)
            vaults = vaults.filter((vault) => vault.vaultId !== vaultId)
            if (active?.vaultId === vaultId) active = null
            return existed
        }),
        listVaults: vi.fn(async () => [...vaults]),
        readActiveVault: vi.fn(async () => active),
        readPreference: vi.fn(async () => null),
        readVault: vi.fn(async (vaultId) => vaults.find((vault) => vault.vaultId === vaultId) ?? null),
        saveAndReadBackVault: vi.fn(async (vault) => {
            vaults = [...vaults.filter((candidate) => candidate.vaultId !== vault.vaultId), vault]
            active = vault
            return vault
        }),
        selectActiveVault: vi.fn(async (vaultId) => {
            active = vaults.find((vault) => vault.vaultId === vaultId) ?? null
            return active
        }),
        writePreference: vi.fn(async () => undefined),
    }
    const manager = new PistachioWalletManager({ storage, windowImpl })
    manager.flags = { ...manager.flags, autoLockMinutes: 15, passkeyWalletEnabled: true }
    return { manager, storage }
}

describe('Pistachio Wallet manager connection and vault lifecycle', () => {
    it('opens immediately and rejects the connector bridge when the modal closes', async () => {
        const { manager } = createHarness([] , null)
        const connecting = manager.requestConnection()
        expect(manager.snapshot().view).toBe('wallet')

        manager.close()
        await expect(connecting).rejects.toMatchObject({ code: 'PISTACHIO_CONNECTION_CANCELLED' })
        expect(manager.snapshot().view).toBeNull()
    })

    it('refuses to close while encrypted persistence is active', async () => {
        const { manager } = createHarness([], null)
        await manager.initialize()
        manager.phase = 'persisting'
        manager.view = 'wallet'

        expect(manager.close()).toBe(false)
        expect(manager.snapshot().view).toBe('wallet')
        expect(manager.phase).toBe('persisting')
    })

    it('cancels an unfinished setup and restores the previously selected vault', async () => {
        const { manager, storage } = createHarness()
        await manager.initialize()
        await manager.prepareNewWallet()
        manager.phase = 'passkey-ready'
        manager.client = { terminate: vi.fn() }

        expect(manager.cancelSetup()).toBe(true)
        expect(manager.phase).toBe('locked')
        expect(manager.vault).toEqual(firstVault)
        expect(storage.deleteVault).not.toHaveBeenCalled()
    })

    it('retries storage initialization from a clean loading state', async () => {
        const { manager, storage } = createHarness()
        storage.listVaults.mockRejectedValueOnce(new Error('temporary storage failure'))
        await manager.initialize()
        expect(manager.phase).toBe('storage-error')

        await manager.retryInitialization()
        expect(manager.phase).toBe('locked')
        expect(manager.error).toBeNull()
        expect(storage.listVaults).toHaveBeenCalledTimes(2)
    })

    it('resolves the same pending connector after successful create or unlock', async () => {
        const { manager } = createHarness()
        await manager.initialize()
        const connecting = manager.requestConnection()
        manager.phase = 'unlocked'
        manager.address = firstVault.address
        manager.resolveConnection()

        await expect(connecting).resolves.toBe(firstVault.address)
        expect(manager.snapshot().view).toBeNull()
    })

    it('resolves connector state when passkey-first onboarding continues unlocked', async () => {
        const { manager, storage } = createHarness()
        await manager.initialize()
        manager.phase = 'onboarding-ready'
        manager.address = firstVault.address
        const connecting = manager.requestConnection()

        await manager.finishOnboarding({ continueUnlocked: true })

        await expect(connecting).resolves.toBe(firstVault.address)
        expect(manager.phase).toBe('unlocked')
        expect(manager.snapshot().sessionActive).toBe(true)
        expect(storage.writePreference).toHaveBeenCalledWith('activeSessionVaultId', firstVault.vaultId)
    })

    it('restores the lock screen session after a refresh for the same saved vault', async () => {
        const { manager, storage } = createHarness()
        storage.readPreference.mockImplementation(async (key) => key === 'activeSessionVaultId' ? firstVault.vaultId : null)

        await manager.initialize()

        expect(manager.snapshot()).toMatchObject({
            phase: 'locked',
            selectedVaultId: firstVault.vaultId,
            sessionActive: true,
        })
        await expect(manager.providerRequest({ method: 'eth_accounts' })).resolves.toEqual([firstVault.address])
    })

    it('keeps a recent refreshed session connected and reauthenticates on first signing use', async () => {
        const { manager, storage } = createHarness()
        const activityAt = Date.now() - 60_000
        storage.readPreference.mockImplementation(async (key) => ({
            activeSessionVaultId: firstVault.vaultId,
            lastWalletActivityAt: activityAt,
            sessionResumeEligible: true,
        })[key] ?? null)

        await manager.initialize()

        expect(manager.snapshot()).toMatchObject({
            phase: 'locked',
            sessionActive: true,
            resumeReauthPending: true,
        })
        expect(manager.window.setTimeout).toHaveBeenCalledWith(
            expect.any(Function),
            expect.any(Number),
        )

        manager.unlock = vi.fn(async () => {
            manager.phase = 'unlocked'
            manager.address = firstVault.address
            manager.client = {}
            manager.resumeReauthPending = false
        })
        await manager.ensureUnlockedForSigning()
        expect(manager.unlock).toHaveBeenCalledOnce()
    })

    it('does not resume a refreshed session after fifteen minutes of wallet inactivity', async () => {
        const { manager, storage } = createHarness()
        storage.readPreference.mockImplementation(async (key) => ({
            activeSessionVaultId: firstVault.vaultId,
            lastWalletActivityAt: Date.now() - 16 * 60_000,
            sessionResumeEligible: true,
        })[key] ?? null)

        await manager.initialize()

        expect(manager.snapshot()).toMatchObject({
            phase: 'locked',
            sessionActive: true,
            resumeReauthPending: false,
        })
        expect(manager.window.setTimeout).not.toHaveBeenCalled()
    })

    it('disconnect locks and terminates the worker without deleting IndexedDB vaults', async () => {
        const { manager, storage } = createHarness()
        await manager.initialize()
        const lockWorker = vi.fn(async () => undefined)
        manager.client = { lock: lockWorker }
        manager.phase = 'unlocked'
        manager.address = firstVault.address
        manager.sessionActive = true

        await manager.disconnect()

        expect(lockWorker).toHaveBeenCalledOnce()
        expect(manager.client).toBeNull()
        expect(manager.phase).toBe('locked')
        expect(manager.snapshot().sessionActive).toBe(false)
        expect(manager.vault.vaultId).toBe(firstVault.vaultId)
        expect(storage.deleteVault).not.toHaveBeenCalled()
        expect(storage.writePreference).toHaveBeenCalledWith('activeSessionVaultId', null)
    })

    it('manual and inactivity locks terminate the worker and clear signing review', async () => {
        const { manager } = createHarness()
        await manager.initialize()
        const firstWorkerLock = vi.fn(async () => undefined)
        manager.client = { lock: firstWorkerLock }
        manager.phase = 'unlocked'
        manager.address = firstVault.address
        manager.sessionActive = true
        manager.view = 'wallet'
        const clearReview = vi.spyOn(manager.reviewQueue, 'clear')

        await manager.lock('manual')
        expect(firstWorkerLock).toHaveBeenCalledOnce()
        expect(clearReview).toHaveBeenCalled()
        expect(manager.phase).toBe('locked')
        expect(manager.snapshot()).toMatchObject({ sessionActive: true, view: null })

        const secondWorkerLock = vi.fn(async () => undefined)
        manager.client = { lock: secondWorkerLock }
        manager.phase = 'unlocked'
        manager.address = firstVault.address
        manager.sessionActive = true
        manager.resetAutoLock()
        expect(manager.window.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 15 * 60_000)
        const inactivityCallback = manager.window.setTimeout.mock.calls.at(-1)[0]
        await inactivityCallback()
        expect(secondWorkerLock).toHaveBeenCalledOnce()
        expect(manager.phase).toBe('locked')
        expect(manager.snapshot().sessionActive).toBe(true)
    })

    it('does not lock just because the tab is hidden', async () => {
        const windowImpl = createWindow()
        const { manager } = createHarness([firstVault], firstVault, windowImpl)
        await manager.initialize()
        manager.phase = 'unlocked'
        manager.address = firstVault.address
        manager.sessionActive = true

        expect(windowImpl.document.addEventListener).not.toHaveBeenCalledWith('visibilitychange', expect.any(Function))
        expect(manager.phase).toBe('unlocked')
    })

    it('does not treat unrelated page input as wallet activity', () => {
        const windowImpl = createWindow()
        createHarness([firstVault], firstVault, windowImpl)

        expect(windowImpl.addEventListener).not.toHaveBeenCalledWith(
            'pointerdown',
            expect.any(Function),
            expect.anything(),
        )
        expect(windowImpl.addEventListener).not.toHaveBeenCalledWith(
            'keydown',
            expect.any(Function),
            expect.anything(),
        )
    })

    it('locks the current worker when another tab unlocks the same vault', async () => {
        let channelListener
        const windowImpl = createWindow()
        windowImpl.BroadcastChannel = class {
            addEventListener(_event, listener) { channelListener = listener }
            postMessage() {}
        }
        const { manager } = createHarness([firstVault], firstVault, windowImpl)
        await manager.initialize()
        const lockWorker = vi.fn(async () => undefined)
        manager.client = { lock: lockWorker }
        manager.phase = 'unlocked'
        manager.address = firstVault.address

        channelListener({ data: { type: 'unlocked', tabId: 'another-tab', vaultId: firstVault.vaultId } })
        await vi.waitFor(() => expect(lockWorker).toHaveBeenCalledOnce())
        expect(manager.phase).toBe('locked')
        expect(manager.address).toBeNull()
    })

    it('reconnect after disconnect detects the same encrypted previous wallet', async () => {
        const { manager } = createHarness()
        await manager.initialize()
        manager.client = { lock: vi.fn(async () => undefined) }
        manager.phase = 'unlocked'
        manager.address = firstVault.address
        await manager.disconnect()

        const reconnecting = manager.requestConnection()
        expect(manager.snapshot()).toMatchObject({
            phase: 'locked',
            view: 'wallet',
            selectedVaultId: firstVault.vaultId,
        })
        expect(manager.snapshot().vault.address).toBe(firstVault.address)
        manager.close()
        await expect(reconnecting).rejects.toMatchObject({ code: 'PISTACHIO_CONNECTION_CANCELLED' })
    })

    it('prepares another wallet without overwriting or deleting the previous vault', async () => {
        const { manager, storage } = createHarness()
        await manager.initialize()
        await manager.prepareNewWallet()

        expect(manager.vault).toBeNull()
        expect(manager.vaults).toEqual([firstVault])
        expect(manager.setupPreviousVaultId).toBe(firstVault.vaultId)
        expect(storage.deleteVault).not.toHaveBeenCalled()
        expect(storage.saveAndReadBackVault).not.toHaveBeenCalled()
    })

    it('persists a second encrypted vault while preserving the previous vault', async () => {
        const { manager, storage } = createHarness()
        await manager.initialize()
        await manager.prepareNewWallet()
        manager.phase = 'confirm-import'
        manager.pendingVaultId = secondVault.vaultId
        manager.client = {
            request: vi.fn(async (operation) => {
                if (operation === 'encryptVault') return { vault: secondVault }
                if (operation === 'verifyPersistedVault') return { verified: true, address: secondVault.address }
                throw new Error('Unexpected worker operation.')
            }),
        }

        await manager.persistPendingWallet()

        expect(storage.saveAndReadBackVault).toHaveBeenCalledWith(secondVault)
        expect(manager.vaults.map((vault) => vault.vaultId).sort()).toEqual([firstVault.vaultId, secondVault.vaultId].sort())
        expect(manager.vault).toEqual(secondVault)
    })

    it('locks the previous worker before selecting another saved vault', async () => {
        const { manager, storage } = createHarness([firstVault, secondVault], firstVault)
        await manager.initialize()
        const lockWorker = vi.fn(async () => undefined)
        manager.client = { lock: lockWorker }
        manager.phase = 'unlocked'
        manager.address = firstVault.address

        await manager.selectVault(secondVault.vaultId)

        expect(lockWorker).toHaveBeenCalledOnce()
        expect(storage.selectActiveVault).toHaveBeenCalledWith(secondVault.vaultId)
        expect(manager.vault).toEqual(secondVault)
        expect(manager.phase).toBe('locked')
    })

    it('deletes only after backup acknowledgement and exact typed confirmation', async () => {
        const { manager, storage } = createHarness([firstVault, secondVault], firstVault)
        await manager.initialize()

        await expect(manager.deleteLocalVault(firstVault.vaultId, { backupAcknowledged: true, confirmation: 'delete' })).rejects.toMatchObject({ code: 'PISTACHIO_VAULT_DELETE_CONFIRMATION_REQUIRED' })
        expect(storage.deleteVault).not.toHaveBeenCalled()

        await manager.deleteLocalVault(firstVault.vaultId, { backupAcknowledged: true, confirmation: 'DELETE' })
        expect(storage.deleteVault).toHaveBeenCalledWith(firstVault.vaultId)
        expect(manager.vault).toEqual(secondVault)
    })

    it('switches only to curated chains and invalidates an active review', async () => {
        const { manager } = createHarness()
        await manager.initialize()
        manager.phase = 'unlocked'
        manager.address = firstVault.address
        manager.client = { request: vi.fn() }

        const signing = manager.signMessage({ message: 'chain-bound review' })
        const rejected = expect(signing).rejects.toMatchObject({ code: 'PISTACHIO_SIGNING_CONTEXT_CHANGED' })
        await vi.waitFor(() => expect(manager.reviewQueue.snapshot()).not.toBeNull())
        await manager.switchChain(8453)

        await rejected
        expect(manager.snapshot()).toMatchObject({ chainId: 8453, chainName: 'Base' })
        await expect(manager.providerRequest({ method: 'eth_chainId' })).resolves.toBe('0x2105')
        expect(manager.client.request).not.toHaveBeenCalled()
        await expect(manager.providerRequest({ method: 'eth_signTransaction', params: [{}] })).rejects.toMatchObject({ code: 'PISTACHIO_CHAIN_INVARIANT_FAILED' })
        await expect(manager.switchChain(999999)).rejects.toMatchObject({ code: 'PISTACHIO_CHAIN_NOT_ALLOWED' })
    })

    it('verifies the chain-specific RPC and returned signed transaction hash before accepting broadcast', async () => {
        const signer = new Wallet(keccak256(toUtf8Bytes('pistachio-manager-multichain-test')))
        const fetchImpl = vi.fn(async (_url, options) => {
            const request = JSON.parse(options.body)
            const result = request.method === 'eth_chainId'
                ? '0x2105'
                : keccak256(request.params[0])
            return { ok: true, json: async () => ({ jsonrpc: '2.0', id: request.id, result }) }
        })
        const { manager } = createHarness()
        manager.fetch = fetchImpl
        manager.rpcUrlForChain = vi.fn(() => 'https://base.example.test/')
        await manager.initialize()
        await manager.switchChain(8453)
        manager.phase = 'unlocked'
        manager.address = signer.address
        manager.client = {
            request: vi.fn(async (_operation, { transaction }) => ({
                signedTransaction: await signer.signTransaction({
                    ...transaction,
                    gasLimit: transaction.gas,
                }),
            })),
        }
        const transaction = {
            chainId: 8453,
            data: '0x',
            gas: 21_000,
            gasPrice: 1,
            nonce: 0,
            to: '0x000000000000000000000000000000000000dEaD',
            type: 0,
            value: 1,
        }

        const sending = manager.sendTransaction(transaction)
        await vi.waitFor(() => expect(manager.reviewQueue.snapshot()).not.toBeNull())
        manager.reviewQueue.approve(manager.reviewQueue.snapshot().id)
        await expect(sending).resolves.toMatch(/^0x[0-9a-f]{64}$/u)
        expect(manager.rpcUrlForChain).toHaveBeenCalledOnce()
        expect(fetchImpl.mock.calls.map(([, options]) => JSON.parse(options.body).method)).toEqual([
            'eth_chainId',
            'eth_sendRawTransaction',
        ])
    })

    it('keeps strict public RPC URL and chain ID parsing', () => {
        expect(walletManagerInternals.normalizePublicRpcUrl(8453, 'https://base.example.test')).toBe('https://base.example.test/')
        expect(() => walletManagerInternals.normalizePublicRpcUrl(8453, 'http://base.example.test')).toThrowError(expect.objectContaining({ code: 'PISTACHIO_PUBLIC_RPC_INVALID' }))
        expect(walletManagerInternals.parseRpcChainId('0x2105')).toBe(8453)
        expect(() => walletManagerInternals.parseRpcChainId('8453')).toThrowError(expect.objectContaining({ code: 'PISTACHIO_RPC_CHAIN_MISMATCH' }))
    })
})
