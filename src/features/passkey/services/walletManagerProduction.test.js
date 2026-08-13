import { describe, expect, it, vi } from 'vitest'

import {
    hardenPistachioWalletManager,
    walletManagerProductionInternals,
} from './walletManagerProduction.js'

const address = '0x1111111111111111111111111111111111111111'

function authenticationMessage(title) {
    const issuedAt = new Date(Date.now() - 1_000)
    const expiresAt = new Date(Date.now() + 5 * 60_000)
    const crossChain = title === 'PistachioSwap Cross-Chain Authentication'
    return [
        title,
        '',
        'Domain: swap.example',
        `Wallet: ${address}`,
        crossChain ? 'Source Chain ID: 56' : 'Chain ID: 56',
        'Nonce: abcdefghijklmnopqrstuvwxyz012345',
        `Issued At: ${issuedAt.toISOString()}`,
        `Expiration Time: ${expiresAt.toISOString()}`,
        '',
        crossChain
            ? 'This signature authenticates this wallet for cross-chain route mutations on the source chain.'
            : 'This signature authenticates your wallet. It does not authorize a transaction.',
        ...(crossChain
            ? ['It does not authorize or submit a transaction.']
            : []),
    ].join('\n')
}

function createManager({ withVault = true } = {}) {
    const manager = {
        activeChainId: 56,
        activeSessionVaultId: null,
        address: null,
        client: null,
        connectionBridge: {
            resolve: vi.fn(() => true),
        },
        ensureUnlockedForSigning: vi.fn(),
        error: null,
        initialize: vi.fn(async () => undefined),
        lastWalletActivityAt: null,
        lock: vi.fn(async function lock() {
            this.client = null
            this.address = null
            this.phase = this.vault ? 'locked' : 'empty'
            this.resumeReauthPending = false
            if (this.sessionActive) this.view = null
        }),
        notify: vi.fn(),
        phase: withVault ? 'locked' : 'empty',
        reauthenticate: vi.fn(async () => true),
        requestConnection: vi.fn(async () => 'original-connection'),
        requireUnlocked: vi.fn(function requireUnlocked() {
            if (this.phase !== 'unlocked' || !this.address || !this.client) {
                const error = new Error('locked')
                error.code = 'PISTACHIO_WALLET_LOCKED'
                throw error
            }
        }),
        resumeReauthPending: false,
        revealRecoveryPhrase: vi.fn(async function revealRecoveryPhrase() {
            await this.reauthenticate()
            return 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu'
        }),
        reviewQueue: {},
        rpcUrlForChain: vi.fn(() => 'https://rpc.example'),
        selectVault: vi.fn(async function selectVault() {}),
        sendTransaction: vi.fn(async () => '0xtransaction'),
        sessionActive: false,
        signMegaFuelPackage: vi.fn(async function signMegaFuelPackage(input) {
            await this.ensureUnlockedForSigning()
            return { orderId: input.orderId, signedTransactions: [] }
        }),
        signMegaFuelTransaction: vi.fn(async () => '0xmegafuel'),
        signMessage: vi.fn(async function signMessage() {
            await this.ensureUnlockedForSigning()
            return '0xsignature'
        }),
        signTypedData: vi.fn(async () => '0xtyped'),
        snapshot: vi.fn(function snapshot() {
            return Object.freeze({
                address: this.address,
                phase: this.phase,
                resumeReauthPending: this.resumeReauthPending,
                sessionActive: this.sessionActive,
                vault: this.vault,
                view: this.view,
            })
        }),
        storage: {
            writePreference: vi.fn(async () => undefined),
        },
        switchChain: vi.fn(async function switchChain(chainId) {
            this.activeChainId = Number(BigInt(chainId))
        }),
        unlock: vi.fn(async function unlock() {
            this.client = {}
            this.address = this.vault.address
            this.phase = 'unlocked'
            this.sessionActive = true
            this.activeSessionVaultId = this.vault.vaultId
            return this.address
        }),
        vault: withVault
            ? { address, vaultId: 'vault-1' }
            : null,
        view: 'wallet',
        window: null,
        clearActiveSession: vi.fn(async function clearActiveSession() {
            this.sessionActive = false
            this.activeSessionVaultId = null
            this.resumeReauthPending = false
        }),
    }
    return manager
}

describe('production Pistachio Wallet hardening', () => {
    it('connects a saved wallet in read-only mode without requesting a passkey', async () => {
        const manager = createManager()
        const originalConnection = manager.requestConnection
        const originalUnlock = manager.unlock
        hardenPistachioWalletManager(manager)

        await expect(manager.requestConnection()).resolves.toBe(address)
        expect(originalConnection).not.toHaveBeenCalled()
        expect(originalUnlock).not.toHaveBeenCalled()
        expect(manager).toMatchObject({
            activeSessionVaultId: 'vault-1',
            address: null,
            phase: 'locked',
            resumeReauthPending: true,
            sessionActive: true,
            view: null,
        })
        expect(manager.connectionBridge.resolve).toHaveBeenCalledWith(address)
        expect(manager.snapshot().signingPasskeyOnly).toBe(true)
    })

    it('opens the wallet page with one passkey check and reuses that view authorization until the page reloads', async () => {
        const manager = createManager()
        const originalUnlock = manager.unlock
        hardenPistachioWalletManager(manager)

        await manager.openWalletView()
        expect(originalUnlock).toHaveBeenCalledOnce()
        expect(manager.snapshot()).toMatchObject({
            phase: 'unlocked',
            view: 'wallet',
            walletViewAuthorized: true,
        })

        manager.view = null
        await manager.openWalletView()
        expect(originalUnlock).toHaveBeenCalledOnce()
        expect(manager.view).toBe('wallet')
    })

    it('requests the passkey for a sensitive action and wipes the worker afterward', async () => {
        const manager = createManager()
        const originalLock = manager.lock
        const originalUnlock = manager.unlock
        manager.sessionActive = true
        hardenPistachioWalletManager(manager)

        await expect(manager.signMessage({ message: 'Confirm' }))
            .resolves.toBe('0xsignature')
        expect(originalUnlock).toHaveBeenCalledOnce()
        expect(originalLock).toHaveBeenCalledOnce()
        expect(manager).toMatchObject({
            address: null,
            client: null,
            phase: 'locked',
            resumeReauthPending: true,
            sessionActive: true,
        })
    })

    it('treats one-shot Gas Assist package signing as a sensitive action and wipes the worker afterward', async () => {
        const manager = createManager()
        const originalPackageSigner = manager.signMegaFuelPackage
        const originalLock = manager.lock
        const originalUnlock = manager.unlock
        manager.sessionActive = true
        hardenPistachioWalletManager(manager)

        await expect(manager.signMegaFuelPackage({ orderId: 'order-1' }))
            .resolves.toEqual({ orderId: 'order-1', signedTransactions: [] })
        expect(originalPackageSigner).toHaveBeenCalledOnce()
        expect(originalUnlock).toHaveBeenCalledOnce()
        expect(originalLock).toHaveBeenCalledOnce()
        expect(manager).toMatchObject({
            address: null,
            client: null,
            phase: 'locked',
            resumeReauthPending: true,
            sessionActive: true,
        })
    })

    it('uses one passkey for the bounded Gas Assist authentication and package flow', async () => {
        const manager = createManager()
        const originalLock = manager.lock
        const originalUnlock = manager.unlock
        const originalReauthenticate = manager.reauthenticate
        manager.sessionActive = true
        hardenPistachioWalletManager(manager)

        await manager.signMessage({
            message: authenticationMessage(
                'PistachioSwap Cross-Chain Authentication',
            ),
        })
        await manager.signMessage({
            message: authenticationMessage(
                'PistachioSwap Gas Assist Authentication',
            ),
        })

        expect(originalUnlock).toHaveBeenCalledOnce()
        expect(originalReauthenticate).not.toHaveBeenCalled()
        expect(originalLock).not.toHaveBeenCalled()
        expect(manager.phase).toBe('unlocked')

        await expect(manager.signMegaFuelPackage({ orderId: 'order-1' }))
            .resolves.toEqual({ orderId: 'order-1', signedTransactions: [] })
        expect(originalUnlock).toHaveBeenCalledOnce()
        expect(originalReauthenticate).not.toHaveBeenCalled()
        expect(originalLock).toHaveBeenCalledOnce()
        expect(manager).toMatchObject({
            address: null,
            client: null,
            phase: 'locked',
            sessionActive: true,
        })
    })

    it('does not reuse a passkey for a malformed lookalike authentication message', async () => {
        const manager = createManager()
        const originalLock = manager.lock
        const originalUnlock = manager.unlock
        manager.sessionActive = true
        hardenPistachioWalletManager(manager)

        await manager.signMessage({
            message: authenticationMessage(
                'PistachioSwap Gas Assist Authentication',
            ).replace('Wallet: ', 'Wallet? '),
        })
        expect(originalUnlock).toHaveBeenCalledOnce()
        expect(originalLock).toHaveBeenCalledOnce()
        expect(manager.phase).toBe('locked')

        await manager.signMegaFuelPackage({ orderId: 'order-1' })
        expect(originalUnlock).toHaveBeenCalledTimes(2)
        expect(originalLock).toHaveBeenCalledTimes(2)
    })

    it('requires fresh user verification when key material is already loaded', async () => {
        const manager = createManager()
        const originalReauthenticate = manager.reauthenticate
        const originalUnlock = manager.unlock
        manager.sessionActive = true
        manager.phase = 'unlocked'
        manager.address = address
        manager.client = {}
        hardenPistachioWalletManager(manager)

        await manager.ensureUnlockedForSigning()
        expect(originalReauthenticate).toHaveBeenCalledOnce()
        expect(originalUnlock).not.toHaveBeenCalled()
    })

    it('keeps the wallet page open after passkey-protected recovery phrase reveal', async () => {
        const manager = createManager()
        const originalUnlock = manager.unlock
        const originalReauthenticate = manager.reauthenticate
        hardenPistachioWalletManager(manager)

        await manager.openWalletView()
        expect(originalUnlock).toHaveBeenCalledOnce()

        await expect(manager.revealRecoveryPhrase()).resolves.toContain('alpha beta gamma')
        expect(originalReauthenticate).toHaveBeenCalledOnce()
        expect(manager).toMatchObject({
            address: null,
            client: null,
            phase: 'locked',
            sessionActive: true,
            view: 'wallet',
        })
        expect(manager.snapshot().walletViewAuthorized).toBe(true)
    })

    it('allows another sensitive reveal from the cached read-only wallet page', async () => {
        const manager = createManager()
        const originalUnlock = manager.unlock
        const originalReauthenticate = manager.reauthenticate
        hardenPistachioWalletManager(manager)

        await manager.openWalletView()
        await manager.revealRecoveryPhrase()
        await expect(manager.revealRecoveryPhrase()).resolves.toContain('alpha beta gamma')

        expect(originalUnlock).toHaveBeenCalledTimes(2)
        expect(originalReauthenticate).toHaveBeenCalledOnce()
        expect(manager).toMatchObject({
            phase: 'locked',
            sessionActive: true,
            view: 'wallet',
        })
    })

    it('rejects unsupported and oversized provider requests before passkey UI', async () => {
        const manager = createManager()
        const originalUnlock = manager.unlock
        manager.sessionActive = true
        hardenPistachioWalletManager(manager)

        await expect(manager.providerRequest({
            method: 'wallet_watchAsset',
            params: [],
        })).rejects.toMatchObject({ code: 4200 })

        await expect(manager.providerRequest({
            method: 'personal_sign',
            params: [
                'x'.repeat(
                    walletManagerProductionInternals.MAX_MESSAGE_CHARS + 1,
                ),
                address,
            ],
        })).rejects.toMatchObject({
            code: 'PISTACHIO_REQUEST_TOO_LARGE',
        })
        expect(originalUnlock).not.toHaveBeenCalled()
    })

    it('limits repeated sensitive requests in one browser tab', async () => {
        const manager = createManager()
        manager.sessionActive = true
        hardenPistachioWalletManager(manager)

        for (
            let index = 0;
            index < walletManagerProductionInternals.SENSITIVE_ACTION_LIMIT;
            index += 1
        ) {
            await manager.signMessage({ message: `request-${index}` })
        }
        await expect(manager.signMessage({ message: 'one-too-many' }))
            .rejects.toMatchObject({
                code: 'PISTACHIO_SENSITIVE_ACTION_RATE_LIMITED',
            })
    })
})
