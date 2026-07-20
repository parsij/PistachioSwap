/* Internal manager method cluster; methods run with the manager instance as `this`. */
/* oxlint-disable no-unused-vars -- shared coordinator dependencies are retained for prototype-installed method clusters. */
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
        this.fetch = fetchImpl.bind(globalThis)
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

}

import { methods as lifecycleMethods } from './walletManagerLifecycle.js'
import { methods as setupMethods } from './walletManagerSetup.js'
import { methods as sessionMethods } from './walletManagerSession.js'
import { methods as signingMethods } from './walletManagerSigning.js'
Object.assign(PistachioWalletManager.prototype, lifecycleMethods, setupMethods, sessionMethods, signingMethods)

/** @returns {PistachioWalletManager} Process-wide browser manager instance used by connector and UI. */
export function getPistachioWalletManager() {
    globalThis[MANAGER_KEY] ??= new PistachioWalletManager()
    return globalThis[MANAGER_KEY]
}

export const walletManagerInternals = { LAST_WALLET_ACTIVITY_PREFERENCE, SESSION_RESUME_ELIGIBLE_PREFERENCE, MANAGER_KEY, messageForReview, normalizeAllowedChainId, normalizePublicRpcUrl, parseRpcChainId, parseTypedData }
