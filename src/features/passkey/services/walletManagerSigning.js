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
const RPC_QUANTITY_PATTERN = /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu

function managerError(code, message) {
    const error = new Error(message)
    error.code = code
    return error
}

function parseRpcQuantity(value, name) {
    if (typeof value !== 'string' || !RPC_QUANTITY_PATTERN.test(value)) {
        throw managerError(
            'PISTACHIO_TRANSACTION_PREPARATION_FAILED',
            `The public RPC returned an invalid transaction ${name}.`,
        )
    }
    return BigInt(value)
}

function toRpcQuantity(value, name) {
    let quantity
    try {
        quantity = BigInt(value)
    } catch {
        throw managerError(
            'PISTACHIO_TRANSACTION_PREPARATION_FAILED',
            `The transaction ${name} is invalid.`,
        )
    }
    if (quantity < 0n) {
        throw managerError(
            'PISTACHIO_TRANSACTION_PREPARATION_FAILED',
            `The transaction ${name} is invalid.`,
        )
    }
    return `0x${quantity.toString(16)}`
}

function normalTransactionType(transaction) {
    const value = transaction?.type
    if (value === undefined || value === null) {
        return transaction?.maxFeePerGas !== undefined ||
            transaction?.maxPriorityFeePerGas !== undefined
            ? 2
            : 0
    }
    if (value === 0 || value === '0' || value === '0x0' || value === 'legacy') return 0
    if (value === 2 || value === '2' || value === '0x2' || value === 'eip1559') return 2
    throw managerError(
        'PISTACHIO_TRANSACTION_PREPARATION_FAILED',
        'Pistachio Wallet supports only legacy and EIP-1559 transactions.',
    )
}

function rpcTransactionForEstimate(transaction) {
    const request = {
        from: getAddress(transaction.from),
        to: getAddress(transaction.to),
        data: transaction.data ?? '0x',
        value: toRpcQuantity(transaction.value ?? 0n, 'value'),
    }
    if (transaction.nonce !== undefined && transaction.nonce !== null) {
        request.nonce = toRpcQuantity(transaction.nonce, 'nonce')
    }
    if (transaction.gas !== undefined && transaction.gas !== null) {
        request.gas = toRpcQuantity(transaction.gas, 'gas limit')
    } else if (transaction.gasLimit !== undefined && transaction.gasLimit !== null) {
        request.gas = toRpcQuantity(transaction.gasLimit, 'gas limit')
    }
    if (transaction.gasPrice !== undefined && transaction.gasPrice !== null) {
        request.gasPrice = toRpcQuantity(transaction.gasPrice, 'gas price')
    }
    if (transaction.maxFeePerGas !== undefined && transaction.maxFeePerGas !== null) {
        request.maxFeePerGas = toRpcQuantity(transaction.maxFeePerGas, 'maximum fee')
    }
    if (transaction.maxPriorityFeePerGas !== undefined && transaction.maxPriorityFeePerGas !== null) {
        request.maxPriorityFeePerGas = toRpcQuantity(
            transaction.maxPriorityFeePerGas,
            'priority fee',
        )
    }
    request.type = normalTransactionType(transaction) === 2 ? '0x2' : '0x0'
    return request
}

async function prepareNormalTransaction(manager, transaction, context) {
    const rpcUrl = manager.rpcUrlForChain(context.chainId)
    const rpcChainId = await manager.rpcRequest(
        context.chainId,
        'eth_chainId',
        [],
        rpcUrl,
    )
    manager.assertSigningContext(context)
    if (parseRpcChainId(rpcChainId) !== context.chainId) {
        throw managerError(
            'PISTACHIO_RPC_CHAIN_MISMATCH',
            'The selected public RPC reported a different chain.',
        )
    }

    const request = {
        ...transaction,
        chainId: context.chainId,
        from: context.address,
    }
    request.type = normalTransactionType(request)

    if (request.nonce === undefined || request.nonce === null) {
        request.nonce = parseRpcQuantity(
            await manager.rpcRequest(
                context.chainId,
                'eth_getTransactionCount',
                [context.address, 'pending'],
                rpcUrl,
            ),
            'nonce',
        )
        manager.assertSigningContext(context)
    }

    if (request.type === 0) {
        if (
            request.maxFeePerGas !== undefined ||
            request.maxPriorityFeePerGas !== undefined
        ) {
            throw managerError(
                'PISTACHIO_TRANSACTION_PREPARATION_FAILED',
                'A legacy transaction cannot contain EIP-1559 fee fields.',
            )
        }
        if (request.gasPrice === undefined || request.gasPrice === null) {
            request.gasPrice = parseRpcQuantity(
                await manager.rpcRequest(
                    context.chainId,
                    'eth_gasPrice',
                    [],
                    rpcUrl,
                ),
                'gas price',
            )
            manager.assertSigningContext(context)
        }
    } else {
        if (request.gasPrice !== undefined && request.gasPrice !== null) {
            throw managerError(
                'PISTACHIO_TRANSACTION_PREPARATION_FAILED',
                'An EIP-1559 transaction cannot contain a legacy gas price.',
            )
        }
        if (
            request.maxFeePerGas === undefined ||
            request.maxFeePerGas === null ||
            request.maxPriorityFeePerGas === undefined ||
            request.maxPriorityFeePerGas === null
        ) {
            throw managerError(
                'PISTACHIO_TRANSACTION_PREPARATION_FAILED',
                'The EIP-1559 transaction is missing its fee fields.',
            )
        }
    }

    if (
        (request.gas === undefined || request.gas === null) &&
        (request.gasLimit === undefined || request.gasLimit === null)
    ) {
        request.gas = parseRpcQuantity(
            await manager.rpcRequest(
                context.chainId,
                'eth_estimateGas',
                [rpcTransactionForEstimate(request)],
                rpcUrl,
            ),
            'gas limit',
        )
        manager.assertSigningContext(context)
    }

    return { request, rpcUrl }
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
    },
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
    },
    async renamePasskey(keyWrapId, label) {
        this.requireUnlocked()
        const normalized = String(label ?? '').trim().slice(0, 80)
        if (!normalized) throw new TypeError('Passkey label is required.')
        const result = await this.client.request('renamePasskeyWrap', { keyWrapId, label: normalized })
        this.vault = await this.storage.saveAndReadBackVault(result.vault)
        this.notify()
    },
    async removePasskey(keyWrapId) {
        await this.reauthenticate()
        if (!this.recoveryBackupConfirmed) throw managerError('PISTACHIO_RECOVERY_BACKUP_REQUIRED', 'Confirm an offline recovery backup before removing a passkey.')
        const result = await this.client.request('removePasskeyWrap', { keyWrapId, backupAcknowledged: true })
        this.vault = await this.storage.saveAndReadBackVault(result.vault)
        this.notify()
    },
    async confirmRecoveryBackup() {
        this.recoveryBackupConfirmed = true
        await this.storage.writePreference('recoveryBackupConfirmed', true)
        this.notify()
    },
    async exportEncryptedBackup() {
        if (this.phase === 'onboarding-ready') {
            return (await this.client.request('exportEncryptedBackup')).backup
        }
        await this.reauthenticate()
        return (await this.client.request('exportEncryptedBackup')).backup
    },
    async exportKeystore(password) {
        if (String(password ?? '').length < 12) throw new TypeError('Encrypted keystore backup password must be at least 12 characters.')
        await this.reauthenticate()
        return (await this.client.request('exportKeystore', { password })).keystore
    },
    async revealRecoveryPhrase() {
        await this.reauthenticate()
        return (await this.client.request('revealRecoveryPhrase')).recoveryPhrase
    },
    async revealPrivateKey() {
        await this.reauthenticate()
        return (await this.client.request('revealPrivateKey')).privateKey
    },
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
    },
    async signMessage({ message, messageBytes }, { skipReview = false } = {}) {
        const display = messageBytes ? messageForReview(getBytes(messageBytes)) : String(message)
        let context
        if (skipReview) {
            // Production hardening enables this only for an exact, short-lived,
            // wallet-bound PistachioSwap authentication challenge. The user's
            // Gas Assist CTA and the final exact package review remain the
            // transaction authorization boundaries.
            await this.ensureUnlockedForSigning()
            context = this.captureSigningContext(this.activeChainId)
        } else {
            context = await this.review('Sign message', { chainId: this.activeChainId, completeMessage: display, purpose: 'Wallet authentication or application request' })
        }
        const result = await this.client.request('signMessage', messageBytes
            ? { messageBytes: bytesToBase64Url(getBytes(messageBytes)) }
            : { message })
        this.assertSigningContext(context)
        if (skipReview) await this.recordActivity()
        return result.signature
    },
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
    },
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
    },
    async sendTransaction(transaction) {
        await this.ensureUnlockedForSigning()
        const requestedChainId = transaction?.chainId === undefined
            ? this.activeChainId
            : normalizeAllowedChainId(transaction.chainId)
        const context = this.captureSigningContext(requestedChainId)
        if (transaction?.from && getAddress(transaction.from) !== getAddress(context.address)) {
            throw managerError('PISTACHIO_ACCOUNT_MISMATCH', 'Transaction account mismatch.')
        }
        const { request, rpcUrl } = await prepareNormalTransaction(
            this,
            transaction,
            context,
        )
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
            const transactionHash = await this.rpcRequest(context.chainId, 'eth_sendRawTransaction', [signedTransaction], rpcUrl)
            this.assertSigningContext(context)
            if (!/^0x[0-9a-f]{64}$/iu.test(transactionHash ?? '')) throw managerError('PISTACHIO_TRANSACTION_BROADCAST_FAILED', 'The public RPC returned an invalid transaction hash.')
            return validateBroadcastTransactionHash({ signedTransaction, transactionHash })
        } finally {
            signedTransaction = null
        }
    },
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

export const walletManagerSigningInternals = {
    normalTransactionType,
    parseRpcQuantity,
    prepareNormalTransaction,
    rpcTransactionForEstimate,
    toRpcQuantity,
}
