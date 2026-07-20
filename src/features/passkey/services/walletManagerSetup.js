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
    },
    async createMnemonicWallet() {
        if (this.phase !== 'passkey-ready') throw managerError('PISTACHIO_PASSKEY_REQUIRED', 'Create and verify a PRF-capable passkey first.')
        const result = await this.client.request('createMnemonicWallet')
        this.phase = 'confirm-recovery'
        this.notify()
        return result
    },
    async importMnemonic(mnemonic) {
        if (!this.flags.walletImportEnabled || this.phase !== 'passkey-ready') throw managerError('PISTACHIO_WALLET_IMPORT_DISABLED', 'Wallet import is disabled.')
        const result = await this.client.request('importMnemonic', { mnemonic })
        this.phase = 'confirm-import'
        this.notify()
        return result
    },
    async importPrivateKey(privateKey) {
        if (!this.flags.walletImportEnabled || this.phase !== 'passkey-ready') throw managerError('PISTACHIO_WALLET_IMPORT_DISABLED', 'Wallet import is disabled.')
        const result = await this.client.request('importPrivateKey', { privateKey })
        this.phase = 'confirm-import'
        this.notify()
        return result
    },
    async importKeystore(json, password) {
        if (!this.flags.keystoreImportEnabled || this.phase !== 'passkey-ready') throw managerError('PISTACHIO_KEYSTORE_IMPORT_DISABLED', 'Keystore import is disabled.')
        if (new TextEncoder().encode(String(json ?? '')).byteLength > PISTACHIO_MAX_KEYSTORE_BYTES) throw new TypeError('Keystore exceeds 1 MiB.')
        const result = await this.client.request('importKeystore', { json, password })
        this.phase = 'confirm-import'
        this.notify()
        return result
    },
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
    },
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
    },
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
}
