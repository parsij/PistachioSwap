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
    },
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
    },
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
    },
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
    },
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
    },
    async disconnect() {
        await this.clearActiveSession()
        await this.lock('connector-disconnect')
        this.reviewQueue.clear('PISTACHIO_WALLET_DISCONNECTED')
        this.view = null
        this.rejectConnection(connectionError('PISTACHIO_CONNECTION_CANCELLED', 'Pistachio Wallet disconnected.'))
        this.notify()
    },
    async clearActiveSession() {
        this.sessionActive = false
        this.activeSessionVaultId = null
        this.resumeReauthPending = false
        this.lastWalletActivityAt = null
        await this.storage.writePreference(ACTIVE_SESSION_VAULT_PREFERENCE, null).catch(() => {})
        await this.storage.writePreference(LAST_WALLET_ACTIVITY_PREFERENCE, null).catch(() => {})
        await this.storage.writePreference(SESSION_RESUME_ELIGIBLE_PREFERENCE, false).catch(() => {})
    },
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
    },
    async exportStoredVaultBackup(vaultId) {
        await this.initialize()
        const vault = await this.storage.readVault(vaultId)
        if (!vault) throw managerError('PISTACHIO_VAULT_NOT_FOUND', 'The selected Pistachio Wallet does not exist.')
        return JSON.stringify(vault, null, 2)
    },
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
    },
    requireUnlocked() {
        if (this.phase !== 'unlocked' || !this.address || !this.client) throw managerError('PISTACHIO_WALLET_LOCKED', 'Unlock Pistachio Wallet first.')
    },
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
    },
    captureSigningContext(expectedChainId = this.activeChainId) {
        this.requireUnlocked()
        const chainId = normalizeAllowedChainId(expectedChainId)
        if (chainId !== this.activeChainId) throw managerError('PISTACHIO_CHAIN_INVARIANT_FAILED', 'The request is not for the active chain.')
        return Object.freeze({
            address: this.address,
            chainId,
            generation: this.signingContextGeneration,
        })
    },
    assertSigningContext(context) {
        this.requireUnlocked()
        if (
            context.generation !== this.signingContextGeneration ||
            context.chainId !== this.activeChainId ||
            getAddress(context.address) !== getAddress(this.address)
        ) {
            throw managerError('PISTACHIO_SIGNING_CONTEXT_CHANGED', 'The active chain or wallet account changed during signing.')
        }
    },
    async switchChain(chainId) {
        const normalizedChainId = normalizeAllowedChainId(chainId)
        if (normalizedChainId === this.activeChainId) return getCuratedEvmChain(normalizedChainId)
        this.signingContextGeneration += 1
        this.reviewQueue.clear('PISTACHIO_SIGNING_CONTEXT_CHANGED')
        this.activeChainId = normalizedChainId
        this.notify()
        return getCuratedEvmChain(normalizedChainId)
    },
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
}
