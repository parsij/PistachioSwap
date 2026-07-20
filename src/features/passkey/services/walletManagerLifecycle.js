/* oxlint-disable no-unused-vars -- shared imports support methods installed on the manager prototype. */
/* Internal manager method cluster; methods run with the manager instance as `this`. */
import { getBytes, toUtf8String } from 'ethers'
import { getAddress } from 'viem'

import {
    DEFAULT_CHAIN_ID,
    getCuratedEvmChain,
    isCuratedEvmChainId,
} from '../../../web3/curatedEvmChains.js'
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
} from '../../gas-assist/services/metamaskMultichain.js'

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

/**
 * Owns the passkey wallet vault/session state machine and serializes sensitive operations.
 * Public methods create/unlock/lock vaults, review and sign requests, and broadcast only after validation.
 * Secret material remains worker-owned and is cleared on lock, timeout, account change, or disposal.
 */

export const methods = {
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
    },
    subscribe(subscriber) {
        this.subscribers.add(subscriber)
        subscriber(this.snapshot())
        return () => this.subscribers.delete(subscriber)
    },
    notify() {
        const snapshot = this.snapshot()
        for (const subscriber of this.subscribers) subscriber(snapshot)
    },
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
    },
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
    },
    open(view = 'wallet') {
        this.view = view
        this.notify()
    },
    close() {
        if (this.phase === 'persisting') return false
        this.view = null
        this.interactionGeneration += 1
        if (['unlocking', 'onboarding-ready'].includes(this.phase)) void this.lock('modal-closed').catch(() => {})
        this.cancelUnpersistedSetup()
        this.rejectConnection(connectionError('PISTACHIO_CONNECTION_CANCELLED', 'Pistachio Wallet connection was cancelled.'))
        this.notify()
        return true
    },
    async retryInitialization() {
        this.initializePromise = null
        this.initialized = false
        this.phase = 'initializing'
        this.error = null
        this.notify()
        return this.initialize()
    },
    cancelSetup() {
        if (this.phase === 'persisting') return false
        this.interactionGeneration += 1
        this.cancelUnpersistedSetup()
        this.error = null
        this.notify()
        return true
    },
    clearError() {
        if (!this.error) return
        this.error = null
        this.notify()
    },
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
    },
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
    },
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
    },
    resolveConnection() {
        if (this.address && this.connectionBridge.resolve(this.address)) {
            this.view = null
            this.notify()
        }
    },
    rejectConnection(error) {
        this.connectionBridge.reject(error)
    },
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
    },
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
    },
    async refreshVaults() {
        this.vaults = await this.storage.listVaults()
        return this.vaults
    },
    destroySynchronously() {
        this.reviewQueue.clear()
        this.client?.terminate('PISTACHIO_WALLET_PAGE_UNLOADED')
        this.client = null
        this.address = null
        if (this.vault) this.phase = 'locked'
    }
}
