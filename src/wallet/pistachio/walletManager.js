import { getBytes, toUtf8String } from 'ethers'
import { getAddress } from 'viem'

import {
    DEFAULT_CHAIN_ID,
    getCuratedEvmChain,
    isCuratedEvmChainId,
} from '../../web3/curatedEvmChains.js'
import {
    PISTACHIO_MAX_KEYSTORE_BYTES,
} from './constants.js'
import { getPistachioWalletFlags } from './featureFlags.js'
import { bytesToBase64Url, wipeBytes } from './passkeyEncoding.js'
import { pistachioError } from './passkeyErrors.js'
import { getPrfForVaultWrap, registerPrfPasskey } from './passkeyService.js'
import { SigningReviewQueue } from './signingReview.js'
import {
    describeTransactionReview,
    validateBroadcastTransactionHash,
    validateLocallySignedTransaction,
} from './transactionValidation.js'
import { validatePistachioVault } from './vaultSchema.js'
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
import { WalletConnectionBridge, connectionError } from './walletConnectionBridge.js'
import { PistachioWalletWorkerClient } from './walletWorkerClient.js'
import {
    normalizePreparedSponsoredTransaction,
    validateSignedPreparedTransaction,
} from '../../services/metamaskMultichain.js'

const MANAGER_KEY = Symbol.for('pistachioswap.pistachio-wallet.manager')
const ACTIVE_SESSION_VAULT_PREFERENCE = 'activeSessionVaultId'
const LAST_WALLET_ACTIVITY_PREFERENCE = 'lastWalletActivityAt'
const SESSION_RESUME_ELIGIBLE_PREFERENCE = 'sessionResumeEligible'

function managerError(code, message) {
    const error = new Error(message)
    error.code = code
    return error
}

function normalizeAllowedChainId(value) {
    let chainId
    try {
        chainId = Number(typeof value === 'string' && /^0x[0-9a-f]+$/iu.test(value) ? BigInt(value) : value)
    } catch {
        throw managerError('PISTACHIO_CHAIN_NOT_ALLOWED', 'This network is not enabled in PistachioSwap.')
    }
    if (!Number.isSafeInteger(chainId) || !isCuratedEvmChainId(chainId)) {
        throw managerError('PISTACHIO_CHAIN_NOT_ALLOWED', 'This network is not enabled in PistachioSwap.')
    }
    return chainId
}

function configuredPublicRpcUrl(chainId) {
    const chain = getCuratedEvmChain(chainId)
    if (chainId === 56) return import.meta.env.VITE_BSC_PUBLIC_RPC_URL
    const environmentValue = import.meta.env[`VITE_EVM_${chainId}_PUBLIC_RPC_URL`]
    return String(environmentValue ?? '').trim() || chain?.rpcUrls?.default?.http?.[0]
}

function parseRpcChainId(value) {
    if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value)) {
        throw managerError('PISTACHIO_RPC_CHAIN_MISMATCH', 'The selected public RPC returned an invalid chain ID.')
    }
    const chainId = Number(BigInt(value))
    if (!Number.isSafeInteger(chainId)) throw managerError('PISTACHIO_RPC_CHAIN_MISMATCH', 'The selected public RPC returned an invalid chain ID.')
    return chainId
}

function normalizePublicRpcUrl(chainId = DEFAULT_CHAIN_ID, value = configuredPublicRpcUrl(chainId)) {
    const allowedChainId = normalizeAllowedChainId(chainId)
    const configured = String(value ?? '').trim()
    let url
    try {
        url = new URL(configured)
    } catch {
        throw managerError('PISTACHIO_PUBLIC_RPC_REQUIRED', `A valid public RPC URL is required for chain ${allowedChainId}.`)
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(import.meta.env.DEV && local && url.protocol === 'http:')) {
        throw managerError('PISTACHIO_PUBLIC_RPC_INVALID', 'The public RPC URL must use HTTPS.')
    }
    if (url.username || url.password || url.hostname.toLowerCase().includes('nodereal')) {
        throw managerError('PISTACHIO_PUBLIC_RPC_INVALID', 'Credential-bearing and NodeReal browser RPC URLs are forbidden.')
    }
    return url.toString()
}

function parseTypedData(value, activeChainId = DEFAULT_CHAIN_ID) {
    let typedData
    try {
        typedData = typeof value === 'string' ? JSON.parse(value) : structuredClone(value)
    } catch {
        throw managerError('PISTACHIO_TYPED_DATA_INVALID', 'Typed data is invalid.')
    }
    if (!typedData?.domain || !typedData?.types || !typedData?.primaryType || !typedData?.message) {
        throw managerError('PISTACHIO_TYPED_DATA_INVALID', 'Typed data is incomplete.')
    }
    if (typedData.domain.chainId !== undefined && Number(typedData.domain.chainId) !== activeChainId) {
        throw managerError('PISTACHIO_CHAIN_INVARIANT_FAILED', 'Typed data is not for the active chain.')
    }
    const { EIP712Domain: _domain, ...types } = typedData.types
    return { ...typedData, types }
}

function messageForReview(hexMessage) {
    try {
        return toUtf8String(hexMessage)
    } catch {
        return hexMessage
    }
}

function normalizeVaultPreferences(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const normalized = {}
    for (const [vaultId, metadata] of Object.entries(value)) {
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) continue
        const label = String(metadata.label ?? '').trim().slice(0, 80)
        const parsedLastUsed = Date.parse(metadata.lastUsedAt)
        normalized[vaultId] = {
            label: label || 'Pistachio Wallet',
            lastUsedAt: Number.isFinite(parsedLastUsed) ? new Date(parsedLastUsed).toISOString() : null,
        }
    }
    return normalized
}

export class PistachioWalletManager {
    constructor({
        workerFactory,
        storage = {
            deleteVault,
            listVaults,
            readActiveVault,
            readPreference,
            readVault,
            saveAndReadBackVault,
            selectActiveVault,
            writePreference,
        },
        windowImpl = globalThis.window,
        fetchImpl = globalThis.fetch,
        rpcUrlForChain = normalizePublicRpcUrl,
    } = {}) {
        this.workerFactory = workerFactory
        this.storage = storage
        this.window = windowImpl
        this.fetch = fetchImpl
        this.rpcUrlForChain = rpcUrlForChain
        this.flags = getPistachioWalletFlags()
        this.client = null
        this.vault = null
        this.vaults = []
        this.vaultPreferences = {}
        this.phase = 'initializing'
        this.address = null
        this.sessionActive = false
        this.activeSessionVaultId = null
        this.resumeReauthPending = false
        this.lastWalletActivityAt = null
        this.activeChainId = DEFAULT_CHAIN_ID
        this.signingContextGeneration = 0
        this.error = null
        this.view = null
        this.pendingVaultId = null
        this.pendingKeyWrap = null
        this.connectionBridge = new WalletConnectionBridge()
        this.setupPreviousVaultId = null
        this.interactionGeneration = 0
        this.subscribers = new Set()
        this.reviewQueue = new SigningReviewQueue()
        this.autoLockTimer = null
        this.tabId = globalThis.crypto?.randomUUID?.() ?? 'unavailable'
        this.broadcastChannel = null
        this.lastUnlockByWrap = {}
        this.recoveryBackupConfirmed = false
        this.initialized = false
        this.initializePromise = null
        this.installLifecycle()
    }

    installLifecycle() {
        if (!this.window?.addEventListener) return
        this.window.addEventListener('pagehide', () => this.destroySynchronously())
        if (typeof this.window.BroadcastChannel === 'function') {
            this.broadcastChannel = new this.window.BroadcastChannel('pistachio-wallet-lock')
            this.broadcastChannel.addEventListener('message', (event) => {
                const message = event.data
                if (message?.type === 'unlocked' && message.vaultId === this.vault?.vaultId && message.tabId !== this.tabId) {
                    this.lock('another-tab-unlocked', { broadcast: false })
                }
            })
        }
    }

    subscribe(subscriber) {
        this.subscribers.add(subscriber)
        subscriber(this.snapshot())
        return () => this.subscribers.delete(subscriber)
    }

    notify() {
        const snapshot = this.snapshot()
        for (const subscriber of this.subscribers) subscriber(snapshot)
    }

    snapshot() {
        return Object.freeze({
            enabled: this.flags.passkeyWalletEnabled,
            flags: this.flags,
            phase: this.phase,
            address: this.address,
            chainId: this.activeChainId,
            chainName: getCuratedEvmChain(this.activeChainId)?.name ?? null,
            sessionActive: this.sessionActive,
            resumeReauthPending: this.resumeReauthPending,
            vault: this.vault ? structuredClone(this.vault) : null,
            vaults: this.vaults.map((vault) => {
                const preference = this.vaultPreferences[vault.vaultId] ?? {}
                return {
                    vaultId: vault.vaultId,
                    name: preference.label || vault.name,
                    address: vault.address,
                    sourceType: vault.sourceType,
                    createdAt: vault.createdAt,
                    lastUsedAt: preference.lastUsedAt || vault.updatedAt,
                    keyWrapCount: vault.keyWraps.length,
                }
            }),
            selectedVaultId: this.vault?.vaultId ?? null,
            error: this.error ? { code: this.error.code, message: this.error.message } : null,
            view: this.view,
            connectionPending: this.connectionBridge.isPending,
            lastUnlockByWrap: { ...this.lastUnlockByWrap },
            recoveryBackupConfirmed: this.recoveryBackupConfirmed,
        })
    }

    async initialize() {
        if (this.initializePromise) return this.initializePromise
        this.initializePromise = (async () => {
            if (!this.flags.passkeyWalletEnabled) {
                this.phase = 'disabled'
                this.initialized = true
                this.notify()
                return
            }
            try {
                this.vaults = await this.storage.listVaults()
                this.vault = await this.storage.readActiveVault()
                if (!this.vault && this.vaults.length > 0) {
                    this.vault = await this.storage.selectActiveVault(this.vaults[0].vaultId)
                }
                this.vaultPreferences = normalizeVaultPreferences(await this.storage.readPreference('vaultPreferences'))
                this.lastUnlockByWrap = await this.storage.readPreference('lastUnlockByWrap') ?? {}
                this.recoveryBackupConfirmed = await this.storage.readPreference('recoveryBackupConfirmed') === true
                const activeSessionVaultId = await this.storage.readPreference(ACTIVE_SESSION_VAULT_PREFERENCE)
                this.activeSessionVaultId = typeof activeSessionVaultId === 'string' ? activeSessionVaultId : null
                this.sessionActive = this.activeSessionVaultId === this.vault?.vaultId
                const storedActivity = Number(
                    await this.storage.readPreference(LAST_WALLET_ACTIVITY_PREFERENCE),
                )
                const resumeEligible =
                    await this.storage.readPreference(
                        SESSION_RESUME_ELIGIBLE_PREFERENCE,
                    ) === true
                this.lastWalletActivityAt = Number.isFinite(storedActivity)
                    ? storedActivity
                    : null
                const inactivityMs = this.flags.autoLockMinutes * 60_000
                const sessionAge = this.lastWalletActivityAt === null
                    ? 0
                    : Math.max(0, Date.now() - this.lastWalletActivityAt)
                this.resumeReauthPending = Boolean(
                    this.sessionActive &&
                    resumeEligible &&
                    this.lastWalletActivityAt !== null &&
                    sessionAge < inactivityMs,
                )
                this.phase = this.vault ? 'locked' : 'empty'
                if (this.resumeReauthPending) {
                    this.resetAutoLock()
                }
            } catch (error) {
                this.error = error
                this.phase = 'storage-error'
            }
            this.initialized = true
            this.notify()
        })()
        return this.initializePromise
    }

    open(view = 'wallet') {
        this.view = view
        this.notify()
    }

    close() {
        if (this.phase === 'persisting') return false
        this.view = null
        this.interactionGeneration += 1
        if (['unlocking', 'onboarding-ready'].includes(this.phase)) void this.lock('modal-closed').catch(() => {})
        this.cancelUnpersistedSetup()
        this.rejectConnection(connectionError('PISTACHIO_CONNECTION_CANCELLED', 'Pistachio Wallet connection was cancelled.'))
        this.notify()
        return true
    }

    async retryInitialization() {
        this.initializePromise = null
        this.initialized = false
        this.phase = 'initializing'
        this.error = null
        this.notify()
        return this.initialize()
    }

    cancelSetup() {
        if (this.phase === 'persisting') return false
        this.interactionGeneration += 1
        this.cancelUnpersistedSetup()
        this.error = null
        this.notify()
        return true
    }

    clearError() {
        if (!this.error) return
        this.error = null
        this.notify()
    }

    cancelUnpersistedSetup() {
        if (this.vault || !['registering-passkey', 'passkey-ready', 'confirm-recovery', 'confirm-import', 'setup-failed', 'empty'].includes(this.phase)) return
        this.client?.terminate('PISTACHIO_WALLET_SETUP_CANCELLED')
        this.client = null
        this.pendingVaultId = null
        this.pendingKeyWrap = null
        this.vault = this.vaults.find((candidate) => candidate.vaultId === this.setupPreviousVaultId) ?? null
        this.setupPreviousVaultId = null
        this.phase = this.vault ? 'locked' : 'empty'
        this.error = null
    }

    freshClient() {
        this.client?.terminate()
        this.client = new PistachioWalletWorkerClient({
            workerFactory: this.workerFactory,
            onFatal: () => {
                this.signingContextGeneration += 1
                this.client = null
                this.address = null
                if (this.vault) {
                    this.phase = 'locked'
                    if (this.sessionActive) this.view = null
                }
                this.reviewQueue.clear('PISTACHIO_WALLET_WORKER_FAILED')
                this.notify()
            },
        })
        return this.client
    }

    async requestConnection() {
        if (!this.flags.passkeyWalletEnabled) throw managerError('PISTACHIO_WALLET_DISABLED', 'Pistachio Wallet is disabled.')
        const connection = this.connectionBridge.wait()
        this.open('wallet')
        try {
            await this.initialize()
            if (this.phase === 'unlocked' && this.address) this.resolveConnection()
        } catch (error) {
            this.rejectConnection(error)
        }
        return connection
    }

    resolveConnection() {
        if (this.address && this.connectionBridge.resolve(this.address)) {
            this.view = null
            this.notify()
        }
    }

    rejectConnection(error) {
        this.connectionBridge.reject(error)
    }

    async prepareNewWallet() {
        await this.initialize()
        if (this.client) await this.lock('wallet-switch')
        await this.clearActiveSession()
        this.setupPreviousVaultId = this.vault?.vaultId ?? null
        this.vault = null
        this.address = null
        this.phase = 'empty'
        this.error = null
        this.notify()
    }

    async selectVault(vaultId) {
        await this.initialize()
        const selected = this.vaults.find((candidate) => candidate.vaultId === vaultId)
        if (!selected) throw managerError('PISTACHIO_VAULT_NOT_FOUND', 'The selected Pistachio Wallet does not exist.')
        if (this.client && this.vault?.vaultId !== selected.vaultId) await this.lock('wallet-switch')
        if (this.vault?.vaultId !== selected.vaultId) await this.clearActiveSession()
        this.vault = await this.storage.selectActiveVault(selected.vaultId)
        this.address = null
        this.phase = 'locked'
        this.error = null
        this.setupPreviousVaultId = null
        this.notify()
        return this.vault
    }

    async refreshVaults() {
        this.vaults = await this.storage.listVaults()
        return this.vaults
    }

    async beginPasskeySetup(label = 'Primary passkey') {
        await this.initialize()
        if (this.vault) throw managerError('PISTACHIO_VAULT_ALREADY_EXISTS', 'A Pistachio Wallet vault already exists.')
        const interactionGeneration = this.interactionGeneration
        this.phase = 'registering-passkey'
        this.error = null
        this.notify()
        this.pendingVaultId = crypto.randomUUID()
        try {
            const registration = await registerPrfPasskey({
                label,
                walletIdentifier: `pistachio-wallet-${this.pendingVaultId}`,
                windowImpl: this.window,
            })
            if (interactionGeneration !== this.interactionGeneration) {
                wipeBytes(registration.prfOutput)
                throw connectionError('PISTACHIO_CONNECTION_CANCELLED', 'Pistachio Wallet setup was cancelled.')
            }
            this.pendingKeyWrap = registration.keyWrap
            try {
                await this.freshClient().transferPrf('setSetupPasskey', { keyWrap: registration.keyWrap }, registration.prfOutput)
                if (registration.prfOutput.byteLength !== 0) throw new TypeError('PRF transfer did not detach the main-thread buffer.')
            } finally {
                wipeBytes(registration.prfOutput)
            }
            this.phase = 'passkey-ready'
            this.notify()
            return registration.capabilities
        } catch (error) {
            this.client?.terminate()
            this.client = null
            if (interactionGeneration !== this.interactionGeneration) throw error
            this.phase = 'setup-failed'
            this.error = error
            this.notify()
            throw error
        }
    }

    async createMnemonicWallet() {
        if (this.phase !== 'passkey-ready') throw managerError('PISTACHIO_PASSKEY_REQUIRED', 'Create and verify a PRF-capable passkey first.')
        const result = await this.client.request('createMnemonicWallet')
        this.phase = 'confirm-recovery'
        this.notify()
        return result
    }

    async importMnemonic(mnemonic) {
        if (!this.flags.walletImportEnabled || this.phase !== 'passkey-ready') throw managerError('PISTACHIO_WALLET_IMPORT_DISABLED', 'Wallet import is disabled.')
        const result = await this.client.request('importMnemonic', { mnemonic })
        this.phase = 'confirm-import'
        this.notify()
        return result
    }

    async importPrivateKey(privateKey) {
        if (!this.flags.walletImportEnabled || this.phase !== 'passkey-ready') throw managerError('PISTACHIO_WALLET_IMPORT_DISABLED', 'Wallet import is disabled.')
        const result = await this.client.request('importPrivateKey', { privateKey })
        this.phase = 'confirm-import'
        this.notify()
        return result
    }

    async importKeystore(json, password) {
        if (!this.flags.keystoreImportEnabled || this.phase !== 'passkey-ready') throw managerError('PISTACHIO_KEYSTORE_IMPORT_DISABLED', 'Keystore import is disabled.')
        if (new TextEncoder().encode(String(json ?? '')).byteLength > PISTACHIO_MAX_KEYSTORE_BYTES) throw new TypeError('Keystore exceeds 1 MiB.')
        const result = await this.client.request('importKeystore', { json, password })
        this.phase = 'confirm-import'
        this.notify()
        return result
    }

    async restoreEncryptedBackup(text) {
        await this.initialize()
        if (new TextEncoder().encode(String(text ?? '')).byteLength > PISTACHIO_MAX_KEYSTORE_BYTES) {
            throw new TypeError('Encrypted Pistachio vault backup exceeds 1 MiB.')
        }
        let parsed
        try {
            parsed = JSON.parse(String(text))
        } catch {
            throw new TypeError('Encrypted Pistachio vault backup is not valid JSON.')
        }
        const vault = validatePistachioVault(parsed)
        if (await this.storage.readVault(vault.vaultId)) {
            throw managerError('PISTACHIO_VAULT_ALREADY_EXISTS', 'This encrypted Pistachio Wallet backup already exists in this browser.')
        }
        if (this.phase === 'unlocked') await this.lock('wallet-switch')
        this.vault = await this.storage.saveAndReadBackVault(vault)
        await this.refreshVaults()
        this.setupPreviousVaultId = null
        this.phase = 'locked'
        this.error = null
        this.notify()
        return this.vault
    }

    async persistPendingWallet() {
        if (!['confirm-recovery', 'confirm-import'].includes(this.phase) || !this.pendingVaultId) {
            throw managerError('PISTACHIO_WALLET_SETUP_INCOMPLETE', 'Wallet setup is incomplete.')
        }
        this.phase = 'persisting'
        this.notify()
        try {
            const encrypted = await this.client.request('encryptVault', { vaultId: this.pendingVaultId })
            const stored = await this.storage.saveAndReadBackVault(encrypted.vault)
            await this.client.request('verifyPersistedVault', { vault: stored })
            this.vault = stored
            await this.refreshVaults()
            this.address = stored.address
            this.pendingVaultId = null
            this.pendingKeyWrap = null
            this.setupPreviousVaultId = null
            this.phase = 'onboarding-ready'
            this.notify()
            return stored
        } catch (error) {
            await this.lock('setup-verification-failed')
            this.phase = 'setup-failed'
            this.error = error
            this.notify()
            throw error
        }
    }

    async finishOnboarding({ continueUnlocked = false } = {}) {
        if (this.phase !== 'onboarding-ready') return
        if (continueUnlocked) {
            this.signingContextGeneration += 1
            this.phase = 'unlocked'
            await this.markUnlocked(this.vault.keyWraps[0].id)
            this.resolveConnection()
            return
        }
        await this.lock('onboarding-complete')
        this.rejectConnection(managerError('PISTACHIO_WALLET_LOCKED', 'Pistachio Wallet was created and locked. Unlock it to connect.'))
    }

    async unlock(keyWrapId = this.vault?.keyWraps[0]?.id) {
        await this.initialize()
        if (!this.vault) throw managerError('PISTACHIO_VAULT_NOT_FOUND', 'No Pistachio Wallet vault exists.')
        const interactionGeneration = this.interactionGeneration
        this.phase = 'unlocking'
        this.error = null
        this.notify()
        try {
            const prfOutput = await getPrfForVaultWrap({ vault: this.vault, keyWrapId, windowImpl: this.window })
            let result
            try {
                if (interactionGeneration !== this.interactionGeneration) {
                    throw connectionError('PISTACHIO_CONNECTION_CANCELLED', 'Pistachio Wallet unlock was cancelled.')
                }
                result = await this.freshClient().transferPrf('unlockVault', { vault: this.vault, keyWrapId }, prfOutput)
                if (prfOutput.byteLength !== 0) throw new TypeError('PRF transfer did not detach the main-thread buffer.')
            } finally {
                wipeBytes(prfOutput)
            }
            if (getAddress(result.address) !== this.vault.address) throw pistachioError('PISTACHIO_WALLET_UNLOCK_FAILED')
            this.signingContextGeneration += 1
            this.address = result.address
            this.phase = 'unlocked'
            await this.markUnlocked(keyWrapId)
            this.resolveConnection()
            return result.address
        } catch (error) {
            this.client?.terminate()
            this.client = null
            this.address = null
            this.phase = 'locked'
            this.error = error?.code ? error : pistachioError('PISTACHIO_WALLET_UNLOCK_FAILED')
            this.notify()
            throw this.error
        }
    }

    async markUnlocked(keyWrapId) {
        const timestamp = new Date().toISOString()
        this.sessionActive = true
        this.activeSessionVaultId = this.vault.vaultId
        this.resumeReauthPending = false
        this.lastUnlockByWrap = { ...this.lastUnlockByWrap, [keyWrapId]: timestamp }
        this.vaultPreferences = {
            ...this.vaultPreferences,
            [this.vault.vaultId]: {
                label: this.vaultPreferences[this.vault.vaultId]?.label || this.vault.name,
                lastUsedAt: timestamp,
            },
        }
        this.storage.writePreference('lastUnlockByWrap', this.lastUnlockByWrap).catch(() => {})
        this.storage.writePreference('vaultPreferences', this.vaultPreferences).catch(() => {})
        await this.storage.writePreference(ACTIVE_SESSION_VAULT_PREFERENCE, this.activeSessionVaultId).catch(() => {})
        await this.storage.writePreference(SESSION_RESUME_ELIGIBLE_PREFERENCE, true).catch(() => {})
        this.broadcastChannel?.postMessage({ type: 'unlocked', vaultId: this.vault.vaultId, tabId: this.tabId })
        await this.recordActivity()
        this.notify()
    }

    resetAutoLock() {
        if (
            !this.window ||
            !this.sessionActive ||
            (!this.resumeReauthPending && this.phase !== 'unlocked')
        ) return
        if (this.autoLockTimer) this.window.clearTimeout(this.autoLockTimer)
        const timeoutMs = this.flags.autoLockMinutes * 60_000
        const elapsedMs = this.lastWalletActivityAt === null
            ? 0
            : Math.max(0, Date.now() - this.lastWalletActivityAt)
        this.autoLockTimer = this.window.setTimeout(
            () => this.lock('inactivity'),
            Math.max(0, timeoutMs - elapsedMs),
        )
    }

    async recordActivity() {
        if (
            !this.sessionActive ||
            (!this.resumeReauthPending && this.phase !== 'unlocked')
        ) return
        this.lastWalletActivityAt = Date.now()
        await Promise.all([
            this.storage.writePreference(
                SESSION_RESUME_ELIGIBLE_PREFERENCE,
                true,
            ).catch(() => {}),
            this.storage.writePreference(
                LAST_WALLET_ACTIVITY_PREFERENCE,
                this.lastWalletActivityAt,
            ).catch(() => {}),
        ])
        this.resetAutoLock()
    }

    async lock(reason = 'manual', { broadcast = true } = {}) {
        this.signingContextGeneration += 1
        this.reviewQueue.clear('PISTACHIO_SIGNING_CONTEXT_CHANGED')
        if (this.autoLockTimer && this.window) this.window.clearTimeout(this.autoLockTimer)
        this.autoLockTimer = null
        try {
            await this.client?.lock()
        } finally {
            this.client = null
            this.address = null
            this.resumeReauthPending = false
            this.lastWalletActivityAt = null
            if (this.vault) {
                this.phase = 'locked'
                if (this.sessionActive && reason !== 'wallet-switch') this.view = null
            }
            await Promise.all([
                this.storage.writePreference(
                    SESSION_RESUME_ELIGIBLE_PREFERENCE,
                    false,
                ).catch(() => {}),
                this.storage.writePreference(
                    LAST_WALLET_ACTIVITY_PREFERENCE,
                    null,
                ).catch(() => {}),
            ])
            if (broadcast) this.broadcastChannel?.postMessage({ type: 'locked', vaultId: this.vault?.vaultId, tabId: this.tabId, reason })
            this.notify()
        }
    }

    async disconnect() {
        await this.clearActiveSession()
        await this.lock('connector-disconnect')
        this.reviewQueue.clear('PISTACHIO_WALLET_DISCONNECTED')
        this.view = null
        this.rejectConnection(connectionError('PISTACHIO_CONNECTION_CANCELLED', 'Pistachio Wallet disconnected.'))
        this.notify()
    }

    async clearActiveSession() {
        this.sessionActive = false
        this.activeSessionVaultId = null
        this.resumeReauthPending = false
        this.lastWalletActivityAt = null
        await this.storage.writePreference(ACTIVE_SESSION_VAULT_PREFERENCE, null).catch(() => {})
        await this.storage.writePreference(LAST_WALLET_ACTIVITY_PREFERENCE, null).catch(() => {})
        await this.storage.writePreference(SESSION_RESUME_ELIGIBLE_PREFERENCE, false).catch(() => {})
    }

    async renameSavedVault(vaultId, label) {
        await this.initialize()
        if (!this.vaults.some((candidate) => candidate.vaultId === vaultId)) {
            throw managerError('PISTACHIO_VAULT_NOT_FOUND', 'The selected Pistachio Wallet does not exist.')
        }
        const normalized = String(label ?? '').trim().slice(0, 80)
        if (!normalized) throw new TypeError('Wallet name is required.')
        this.vaultPreferences = {
            ...this.vaultPreferences,
            [vaultId]: {
                label: normalized,
                lastUsedAt: this.vaultPreferences[vaultId]?.lastUsedAt ?? null,
            },
        }
        await this.storage.writePreference('vaultPreferences', this.vaultPreferences)
        this.notify()
    }

    async exportStoredVaultBackup(vaultId) {
        await this.initialize()
        const vault = await this.storage.readVault(vaultId)
        if (!vault) throw managerError('PISTACHIO_VAULT_NOT_FOUND', 'The selected Pistachio Wallet does not exist.')
        return JSON.stringify(vault, null, 2)
    }

    async deleteLocalVault(vaultId, { backupAcknowledged = false, confirmation = '' } = {}) {
        await this.initialize()
        const target = this.vaults.find((candidate) => candidate.vaultId === vaultId)
        if (!target) throw managerError('PISTACHIO_VAULT_NOT_FOUND', 'The selected Pistachio Wallet does not exist.')
        if (!backupAcknowledged || confirmation !== 'DELETE') {
            throw managerError('PISTACHIO_VAULT_DELETE_CONFIRMATION_REQUIRED', 'Confirm a recovery backup and type DELETE to remove this local wallet.')
        }
        if (this.vault?.vaultId === vaultId) {
            await this.clearActiveSession()
            await this.lock('vault-deleted')
        }
        await this.storage.deleteVault(vaultId)
        delete this.vaultPreferences[vaultId]
        await this.storage.writePreference('vaultPreferences', this.vaultPreferences)
        await this.refreshVaults()
        const nextVault = this.vaults[0] ?? null
        this.vault = nextVault ? await this.storage.selectActiveVault(nextVault.vaultId) : null
        this.address = null
        this.phase = this.vault ? 'locked' : 'empty'
        this.error = null
        this.rejectConnection(connectionError('PISTACHIO_CONNECTION_CANCELLED', 'The selected local wallet was removed.'))
        this.notify()
        return true
    }

    destroySynchronously() {
        this.reviewQueue.clear()
        this.client?.terminate('PISTACHIO_WALLET_PAGE_UNLOADED')
        this.client = null
        this.address = null
        if (this.vault) this.phase = 'locked'
    }

    requireUnlocked() {
        if (this.phase !== 'unlocked' || !this.address || !this.client) throw managerError('PISTACHIO_WALLET_LOCKED', 'Unlock Pistachio Wallet first.')
    }

    async ensureUnlockedForSigning() {
        if (
            this.phase !== 'unlocked' &&
            this.resumeReauthPending &&
            this.sessionActive &&
            this.vault
        ) {
            await this.unlock()
        }
        this.requireUnlocked()
    }

    captureSigningContext(expectedChainId = this.activeChainId) {
        this.requireUnlocked()
        const chainId = normalizeAllowedChainId(expectedChainId)
        if (chainId !== this.activeChainId) throw managerError('PISTACHIO_CHAIN_INVARIANT_FAILED', 'The request is not for the active chain.')
        return Object.freeze({
            address: this.address,
            chainId,
            generation: this.signingContextGeneration,
        })
    }

    assertSigningContext(context) {
        this.requireUnlocked()
        if (
            context.generation !== this.signingContextGeneration ||
            context.chainId !== this.activeChainId ||
            getAddress(context.address) !== getAddress(this.address)
        ) {
            throw managerError('PISTACHIO_SIGNING_CONTEXT_CHANGED', 'The active chain or wallet account changed during signing.')
        }
    }

    async switchChain(chainId) {
        const normalizedChainId = normalizeAllowedChainId(chainId)
        if (normalizedChainId === this.activeChainId) return getCuratedEvmChain(normalizedChainId)
        this.signingContextGeneration += 1
        this.reviewQueue.clear('PISTACHIO_SIGNING_CONTEXT_CHANGED')
        this.activeChainId = normalizedChainId
        this.notify()
        return getCuratedEvmChain(normalizedChainId)
    }

    async rpcRequest(chainId, method, params, rpcUrl = this.rpcUrlForChain(chainId)) {
        const expectedChainId = normalizeAllowedChainId(chainId)
        const requestId = crypto.randomUUID()
        const response = await this.fetch(rpcUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
        })
        const result = await response.json()
        if (!response.ok || result?.jsonrpc !== '2.0' || result?.id !== requestId || result.error) {
            throw managerError('PISTACHIO_TRANSACTION_BROADCAST_FAILED', `The public RPC for chain ${expectedChainId} rejected the request.`)
        }
        return result.result
    }

    async reauthenticate(keyWrapId = this.vault?.keyWraps[0]?.id) {
        this.requireUnlocked()
        const prfOutput = await getPrfForVaultWrap({ vault: this.vault, keyWrapId, windowImpl: this.window })
        let result
        try {
            result = await this.client.transferPrf('verifyExistingPasskey', { vault: this.vault, keyWrapId }, prfOutput)
            if (prfOutput.byteLength !== 0 || result.address !== this.address) throw pistachioError('PISTACHIO_WALLET_UNLOCK_FAILED')
        } finally {
            wipeBytes(prfOutput)
        }
        await this.markUnlocked(keyWrapId)
        return true
    }

    async addBackupPasskey(label) {
        await this.reauthenticate()
        const registration = await registerPrfPasskey({ label, walletIdentifier: `pistachio-wallet-backup-${this.vault.vaultId}`, windowImpl: this.window })
        let result
        try {
            result = await this.client.transferPrf('addPasskeyWrap', { keyWrap: registration.keyWrap }, registration.prfOutput)
            if (registration.prfOutput.byteLength !== 0) throw new TypeError('PRF transfer did not detach the main-thread buffer.')
        } finally {
            wipeBytes(registration.prfOutput)
        }
        this.vault = await this.storage.saveAndReadBackVault(result.vault)
        this.notify()
        return this.vault
    }

    async renamePasskey(keyWrapId, label) {
        this.requireUnlocked()
        const normalized = String(label ?? '').trim().slice(0, 80)
        if (!normalized) throw new TypeError('Passkey label is required.')
        const result = await this.client.request('renamePasskeyWrap', { keyWrapId, label: normalized })
        this.vault = await this.storage.saveAndReadBackVault(result.vault)
        this.notify()
    }

    async removePasskey(keyWrapId) {
        await this.reauthenticate()
        if (!this.recoveryBackupConfirmed) throw managerError('PISTACHIO_RECOVERY_BACKUP_REQUIRED', 'Confirm an offline recovery backup before removing a passkey.')
        const result = await this.client.request('removePasskeyWrap', { keyWrapId, backupAcknowledged: true })
        this.vault = await this.storage.saveAndReadBackVault(result.vault)
        this.notify()
    }

    async confirmRecoveryBackup() {
        this.recoveryBackupConfirmed = true
        await this.storage.writePreference('recoveryBackupConfirmed', true)
        this.notify()
    }

    async exportEncryptedBackup() {
        if (this.phase === 'onboarding-ready') {
            return (await this.client.request('exportEncryptedBackup')).backup
        }
        await this.reauthenticate()
        return (await this.client.request('exportEncryptedBackup')).backup
    }

    async exportKeystore(password) {
        if (String(password ?? '').length < 12) throw new TypeError('Encrypted keystore backup password must be at least 12 characters.')
        await this.reauthenticate()
        return (await this.client.request('exportKeystore', { password })).keystore
    }

    async revealRecoveryPhrase() {
        await this.reauthenticate()
        return (await this.client.request('revealRecoveryPhrase')).recoveryPhrase
    }

    async revealPrivateKey() {
        await this.reauthenticate()
        return (await this.client.request('revealPrivateKey')).privateKey
    }

    async review(action, payload) {
        await this.ensureUnlockedForSigning()
        const context = this.captureSigningContext(payload?.chainId ?? this.activeChainId)
        await this.reviewQueue.request({
            walletAddress: context.address,
            chainId: context.chainId,
            action,
            payload,
        })
        this.assertSigningContext(context)
        await this.recordActivity()
        return context
    }

    async signMessage({ message, messageBytes }) {
        const display = messageBytes ? messageForReview(getBytes(messageBytes)) : String(message)
        const context = await this.review('Sign message', { chainId: this.activeChainId, completeMessage: display, purpose: 'Wallet authentication or application request' })
        const result = await this.client.request('signMessage', messageBytes
            ? { messageBytes: bytesToBase64Url(getBytes(messageBytes)) }
            : { message })
        this.assertSigningContext(context)
        return result.signature
    }

    async signTypedData(typedData) {
        const normalized = parseTypedData(typedData, this.activeChainId)
        const context = await this.review('Sign typed data', {
            domain: normalized.domain,
            chainId: this.activeChainId,
            verifyingContract: normalized.domain.verifyingContract ?? null,
            primaryType: normalized.primaryType,
            fields: normalized.message,
        })
        const result = await this.client.request('signTypedData', {
            domain: normalized.domain,
            types: normalized.types,
            value: normalized.message,
        })
        this.assertSigningContext(context)
        return result.signature
    }

    async signMegaFuelTransaction(transaction) {
        await this.ensureUnlockedForSigning()
        const context = this.captureSigningContext(56)
        const normalized = normalizePreparedSponsoredTransaction(transaction, this.address)
        await this.reviewQueue.request({
            walletAddress: context.address,
            chainId: 56,
            action: 'Sign MegaFuel transaction',
            payload: describeTransactionReview(normalized, 'megafuel'),
        })
        this.assertSigningContext(context)
        let signedTransaction = null
        try {
            signedTransaction = (await this.client.request('signTransaction', { transaction: normalized, mode: 'megafuel' })).signedTransaction
            this.assertSigningContext(context)
            await validateLocallySignedTransaction({ signedTransaction, request: normalized, walletAddress: this.address, mode: 'megafuel' })
            await validateSignedPreparedTransaction({
                signedRawTransaction: signedTransaction,
                normalizedTransaction: normalized,
                authenticatedWalletAddress: this.address,
                multichainAccount: this.address,
            })
            return signedTransaction
        } finally {
            signedTransaction = null
        }
    }

    async sendTransaction(transaction) {
        await this.ensureUnlockedForSigning()
        const requestedChainId = transaction?.chainId === undefined
            ? this.activeChainId
            : normalizeAllowedChainId(transaction.chainId)
        const context = this.captureSigningContext(requestedChainId)
        if (transaction?.from && getAddress(transaction.from) !== getAddress(context.address)) {
            throw managerError('PISTACHIO_ACCOUNT_MISMATCH', 'Transaction account mismatch.')
        }
        const request = { ...transaction, chainId: context.chainId, from: context.address }
        await this.reviewQueue.request({
            walletAddress: context.address,
            chainId: context.chainId,
            action: 'Send transaction',
            payload: describeTransactionReview(request, 'normal'),
        })
        this.assertSigningContext(context)
        let signedTransaction = null
        try {
            signedTransaction = (await this.client.request('signTransaction', { transaction: request, mode: 'normal' })).signedTransaction
            this.assertSigningContext(context)
            await validateLocallySignedTransaction({ signedTransaction, request, walletAddress: context.address, mode: 'normal' })
            const rpcUrl = this.rpcUrlForChain(context.chainId)
            const rpcChainId = await this.rpcRequest(context.chainId, 'eth_chainId', [], rpcUrl)
            this.assertSigningContext(context)
            if (parseRpcChainId(rpcChainId) !== context.chainId) {
                throw managerError('PISTACHIO_RPC_CHAIN_MISMATCH', 'The selected public RPC reported a different chain.')
            }
            const transactionHash = await this.rpcRequest(context.chainId, 'eth_sendRawTransaction', [signedTransaction], rpcUrl)
            this.assertSigningContext(context)
            if (!/^0x[0-9a-f]{64}$/iu.test(transactionHash ?? '')) throw managerError('PISTACHIO_TRANSACTION_BROADCAST_FAILED', 'The public RPC returned an invalid transaction hash.')
            return validateBroadcastTransactionHash({ signedTransaction, transactionHash })
        } finally {
            signedTransaction = null
        }
    }

    async providerRequest({ method, params = [] }) {
        const activeChainHex = `0x${this.activeChainId.toString(16)}`
        if (method === 'eth_chainId') return activeChainHex
        if (method === 'net_version') return String(this.activeChainId)
        if (method === 'eth_accounts') {
            if (this.phase === 'unlocked' && this.address) return [this.address]
            if (this.sessionActive && this.vault?.address) return [this.vault.address]
            return []
        }
        if (method === 'eth_requestAccounts') return [await this.requestConnection()]
        if (method === 'wallet_switchEthereumChain') {
            if (params.length !== 1 || !params[0] || typeof params[0] !== 'object' || Array.isArray(params[0])) {
                throw managerError('PISTACHIO_CHAIN_NOT_ALLOWED', 'A valid allowlisted chain is required.')
            }
            if (typeof params[0].chainId !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(params[0].chainId)) {
                throw managerError('PISTACHIO_CHAIN_NOT_ALLOWED', 'A valid allowlisted chain is required.')
            }
            await this.switchChain(params[0].chainId)
            return null
        }
        if (method === 'wallet_getCapabilities') return { [activeChainHex]: { atomicBatch: { supported: false } } }
        await this.ensureUnlockedForSigning()
        if (method === 'personal_sign') {
            const [message, account] = params
            if (getAddress(account) !== this.address || typeof message !== 'string') throw managerError('PISTACHIO_ACCOUNT_MISMATCH', 'Signing account mismatch.')
            return this.signMessage(message.startsWith('0x') ? { messageBytes: message } : { message })
        }
        if (method === 'eth_signTypedData_v4') {
            const [account, typedData] = params
            if (getAddress(account) !== this.address) throw managerError('PISTACHIO_ACCOUNT_MISMATCH', 'Signing account mismatch.')
            return this.signTypedData(typedData)
        }
        if (method === 'eth_signTransaction') {
            if (this.activeChainId !== 56) throw managerError('PISTACHIO_CHAIN_INVARIANT_FAILED', 'Raw transaction signing is available on BNB Chain only.')
            return this.signMegaFuelTransaction(params[0])
        }
        if (method === 'eth_sendTransaction') return this.sendTransaction(params[0])
        throw managerError(4200, `Pistachio Wallet does not support ${method}.`)
    }
}

export function getPistachioWalletManager() {
    globalThis[MANAGER_KEY] ??= new PistachioWalletManager()
    return globalThis[MANAGER_KEY]
}

export const walletManagerInternals = {
    LAST_WALLET_ACTIVITY_PREFERENCE,
    SESSION_RESUME_ELIGIBLE_PREFERENCE,
    MANAGER_KEY,
    messageForReview,
    normalizeAllowedChainId,
    normalizePublicRpcUrl,
    parseRpcChainId,
    parseTypedData,
}
