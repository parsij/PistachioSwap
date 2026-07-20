import {
    HDNodeWallet,
    Mnemonic,
    Wallet,
    getBytes,
    hexlify,
    randomBytes as ethersRandomBytes,
} from 'ethers'
import { getAddress } from 'viem'

import { isCuratedEvmChainId } from '../../../web3/curatedEvmChains.js'
import {
    PISTACHIO_CHAIN_ID,
    PISTACHIO_DERIVATION_PATH,
    PISTACHIO_MAX_KEYSTORE_BYTES,
} from './constants.js'
import {
    addEncryptedKeyWrap,
    createEncryptedVault,
    decryptEncryptedVault,
    encryptPayload,
} from './vaultCrypto.js'
import { bytesToBase64Url, base64UrlToBytes, wipeBytes } from './passkeyEncoding.js'
import { pistachioError } from './passkeyErrors.js'
import { validatePistachioVault } from './vaultSchema.js'
import {
    validateWorkerRequest,
    workerError,
    workerResponse,
} from './walletWorkerProtocol.js'

let wallet = null
let payload = null
let dek = null
let activeVault = null
let setupPasskey = null
let setupPrf = null

function clearSecrets() {
    wipeBytes(dek)
    wipeBytes(setupPrf)
    wallet = null
    payload = null
    dek = null
    activeVault = null
    setupPasskey = null
    setupPrf = null
}

function requireWallet() {
    if (!wallet || !payload) throw pistachioError('PISTACHIO_WALLET_UNLOCK_FAILED')
    return wallet
}

function requireSetupPrf() {
    if (!setupPasskey || !setupPrf || setupPrf.byteLength !== 32) {
        throw pistachioError('PISTACHIO_WALLET_UNLOCK_FAILED')
    }
}

function setMnemonicWallet(entropy, sourceType) {
    const entropyBytes = Uint8Array.from(entropy)
    const mnemonic = Mnemonic.fromEntropy(entropyBytes)
    wallet = HDNodeWallet.fromMnemonic(mnemonic, PISTACHIO_DERIVATION_PATH)
    payload = {
        kind: 'mnemonic',
        entropy: bytesToBase64Url(entropyBytes),
        language: 'en',
        derivationPath: PISTACHIO_DERIVATION_PATH,
        sourceType,
    }
    entropyBytes.fill(0)
    return { address: getAddress(wallet.address), recoveryPhrase: mnemonic.phrase }
}

function setPrivateKeyWallet(privateKey, sourceType) {
    const candidate = new Wallet(privateKey)
    const privateKeyBytes = getBytes(candidate.privateKey)
    wallet = candidate
    payload = {
        kind: 'private-key',
        privateKey: bytesToBase64Url(privateKeyBytes),
        sourceType,
    }
    privateKeyBytes.fill(0)
    return { address: getAddress(wallet.address) }
}

function restoreWallet(decryptedPayload) {
    if (decryptedPayload?.kind === 'mnemonic') {
        if (decryptedPayload.language !== 'en' || decryptedPayload.derivationPath !== PISTACHIO_DERIVATION_PATH) {
            throw pistachioError('PISTACHIO_WALLET_UNLOCK_FAILED')
        }
        const entropy = base64UrlToBytes(decryptedPayload.entropy, 16)
        try {
            const mnemonic = Mnemonic.fromEntropy(entropy)
            wallet = HDNodeWallet.fromMnemonic(mnemonic, PISTACHIO_DERIVATION_PATH)
        } finally {
            entropy.fill(0)
        }
    } else if (decryptedPayload?.kind === 'private-key') {
        const privateKey = base64UrlToBytes(decryptedPayload.privateKey, 32)
        try {
            wallet = new Wallet(hexlify(privateKey))
        } finally {
            privateKey.fill(0)
        }
    } else {
        throw pistachioError('PISTACHIO_WALLET_UNLOCK_FAILED')
    }
    payload = decryptedPayload
    return getAddress(wallet.address)
}

function parseQuantity(value, name, defaultValue) {
    if (value === undefined || value === null) {
        if (defaultValue !== undefined) return defaultValue
        throw new TypeError(`Missing transaction ${name}.`)
    }
    try {
        const quantity = BigInt(value)
        if (quantity < 0n) throw new Error()
        return quantity
    } catch {
        throw new TypeError(`Invalid transaction ${name}.`)
    }
}

function normalizeTransaction(transaction, mode) {
    if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) throw new TypeError('Invalid transaction.')
    const chainId = Number(transaction.chainId)
    if (!isCuratedEvmChainId(chainId)) throw new TypeError('Pistachio Wallet does not sign transactions for this network.')
    if (mode !== 'normal' && mode !== 'megafuel') throw new TypeError('Invalid transaction signing mode.')
    if (mode === 'megafuel' && chainId !== PISTACHIO_CHAIN_ID) throw new TypeError('Pistachio Wallet signs MegaFuel transactions on BNB Chain only.')
    const from = transaction.from ? getAddress(transaction.from) : getAddress(requireWallet().address)
    if (from !== getAddress(requireWallet().address)) throw new TypeError('Transaction account mismatch.')
    const type = transaction.type === undefined ? 0 : Number(transaction.type)
    const normalized = {
        chainId,
        type,
        to: getAddress(transaction.to),
        nonce: Number(parseQuantity(transaction.nonce, 'nonce')),
        gasLimit: parseQuantity(transaction.gas ?? transaction.gasLimit, 'gas limit'),
        value: parseQuantity(transaction.value, 'value', 0n),
        data: transaction.data ?? '0x',
    }
    if (!Number.isSafeInteger(normalized.nonce)) throw new TypeError('Invalid transaction nonce.')
    if (mode === 'megafuel') {
        if (type !== 0 || parseQuantity(transaction.gasPrice, 'gas price') !== 0n) throw new TypeError('MegaFuel requires a legacy zero-gas transaction.')
        if (transaction.maxFeePerGas !== undefined || transaction.maxPriorityFeePerGas !== undefined || transaction.accessList !== undefined) {
            throw new TypeError('MegaFuel transaction contains unsupported fee fields.')
        }
        normalized.gasPrice = 0n
    } else if (type === 0) {
        normalized.gasPrice = parseQuantity(transaction.gasPrice, 'gas price')
    } else if (type === 2) {
        normalized.maxFeePerGas = parseQuantity(transaction.maxFeePerGas, 'maximum fee')
        normalized.maxPriorityFeePerGas = parseQuantity(transaction.maxPriorityFeePerGas, 'priority fee')
    } else {
        throw new TypeError('Unsupported transaction type.')
    }
    return normalized
}

async function handle(operation, message) {
    if (operation === 'setSetupPasskey') {
        clearSecrets()
        setupPasskey = structuredClone(message.keyWrap)
        setupPrf = new Uint8Array(message.prfOutput)
        if (setupPrf.byteLength !== 32) throw new TypeError('Invalid PRF output.')
        return { ready: true }
    }
    if (operation === 'createMnemonicWallet') {
        requireSetupPrf()
        return setMnemonicWallet(ethersRandomBytes(16), 'generated-mnemonic')
    }
    if (operation === 'importMnemonic') {
        requireSetupPrf()
        const phrase = String(message.mnemonic ?? '').trim().toLowerCase().replace(/\s+/gu, ' ')
        if (!Mnemonic.isValidMnemonic(phrase)) throw new TypeError('The recovery phrase has invalid words or checksum.')
        return setMnemonicWallet(getBytes(Mnemonic.fromPhrase(phrase).entropy), 'imported-mnemonic')
    }
    if (operation === 'importPrivateKey') {
        requireSetupPrf()
        const value = String(message.privateKey ?? '').trim()
        if (!/^(?:0x)?[0-9a-fA-F]{64}$/u.test(value)) throw new TypeError('Private key must be exactly 32 bytes.')
        return setPrivateKeyWallet(value.startsWith('0x') ? value : `0x${value}`, 'imported-private-key')
    }
    if (operation === 'importKeystore') {
        requireSetupPrf()
        const json = String(message.json ?? '')
        if (new TextEncoder().encode(json).byteLength > PISTACHIO_MAX_KEYSTORE_BYTES) throw new TypeError('Keystore exceeds 1 MiB.')
        let parsedKeystore
        try {
            parsedKeystore = JSON.parse(json)
        } catch {
            throw new TypeError('Keystore is not valid JSON.')
        }
        if (parsedKeystore?.version !== 3 || (!parsedKeystore.crypto && !parsedKeystore.Crypto)) {
            throw new TypeError('Only Web3 Secret Storage V3 keystores are supported.')
        }
        const imported = await Wallet.fromEncryptedJson(json, String(message.password ?? ''))
        return setPrivateKeyWallet(imported.privateKey, 'imported-keystore')
    }
    if (operation === 'encryptVault') {
        requireSetupPrf()
        const activeWallet = requireWallet()
        const result = await createEncryptedVault({
            vaultId: message.vaultId,
            address: activeWallet.address,
            rpId: setupPasskey.rpId,
            sourceType: payload.sourceType,
            derivationPath: payload.kind === 'mnemonic' ? PISTACHIO_DERIVATION_PATH : null,
            payload,
            keyWrap: setupPasskey,
            prfOutput: setupPrf,
        })
        wipeBytes(dek)
        dek = result.dek
        activeVault = result.vault
        return { vault: result.vault, address: getAddress(activeWallet.address) }
    }
    if (operation === 'verifyPersistedVault') {
        requireSetupPrf()
        const vault = validatePistachioVault(message.vault)
        const result = await decryptEncryptedVault({ vault, keyWrapId: setupPasskey.id, prfOutput: setupPrf })
        try {
            const address = restoreWallet(result.payload)
            if (address !== vault.address) throw pistachioError('PISTACHIO_WALLET_UNLOCK_FAILED')
            activeVault = vault
            wipeBytes(dek)
            dek = result.dek.slice()
            return { verified: true, address }
        } finally {
            wipeBytes(result.dek)
            wipeBytes(setupPrf)
            setupPrf = null
            setupPasskey = null
        }
    }
    if (operation === 'unlockVault' || operation === 'verifyExistingPasskey') {
        const vault = validatePistachioVault(message.vault)
        const prf = new Uint8Array(message.prfOutput)
        try {
            const result = await decryptEncryptedVault({ vault, keyWrapId: message.keyWrapId, prfOutput: prf })
            try {
                const address = restoreWallet(result.payload)
                if (address !== vault.address) throw pistachioError('PISTACHIO_WALLET_UNLOCK_FAILED')
                wipeBytes(dek)
                dek = result.dek.slice()
                activeVault = vault
                return { address, verified: true }
            } finally {
                wipeBytes(result.dek)
            }
        } finally {
            wipeBytes(prf)
        }
    }
    if (operation === 'getAddress') return { address: getAddress(requireWallet().address) }
    if (operation === 'signMessage') {
        const signable = message.messageBytes
            ? base64UrlToBytes(message.messageBytes)
            : String(message.message ?? '')
        try {
            return { signature: await requireWallet().signMessage(signable) }
        } finally {
            if (signable instanceof Uint8Array) signable.fill(0)
        }
    }
    if (operation === 'signTypedData') {
        return { signature: await requireWallet().signTypedData(message.domain, message.types, message.value) }
    }
    if (operation === 'signTransaction') {
        return { signedTransaction: await requireWallet().signTransaction(normalizeTransaction(message.transaction, message.mode)) }
    }
    if (operation === 'addPasskeyWrap') {
        requireWallet()
        if (!activeVault || !dek) throw pistachioError('PISTACHIO_WALLET_UNLOCK_FAILED')
        const prf = new Uint8Array(message.prfOutput)
        try {
            activeVault = await addEncryptedKeyWrap({ vault: activeVault, payload, dek, keyWrap: message.keyWrap, prfOutput: prf })
            const verification = await decryptEncryptedVault({
                vault: activeVault,
                keyWrapId: message.keyWrap.id,
                prfOutput: prf,
            })
            try {
                if (restoreWallet(verification.payload) !== activeVault.address) {
                    throw pistachioError('PISTACHIO_WALLET_UNLOCK_FAILED')
                }
            } finally {
                wipeBytes(verification.dek)
            }
            return { vault: activeVault }
        } finally {
            wipeBytes(prf)
        }
    }
    if (operation === 'renamePasskeyWrap') {
        requireWallet()
        if (!activeVault || !dek) throw pistachioError('PISTACHIO_WALLET_UNLOCK_FAILED')
        const label = String(message.label ?? '').trim().slice(0, 80)
        if (!label || !activeVault.keyWraps.some((item) => item.id === message.keyWrapId)) {
            throw new TypeError('Passkey label is invalid.')
        }
        const updated = {
            ...activeVault,
            keyWraps: activeVault.keyWraps.map((item) => item.id === message.keyWrapId ? { ...item, label } : item),
            updatedAt: new Date().toISOString(),
        }
        updated.encryptedPayload = await encryptPayload({ vault: updated, payload, dek })
        activeVault = validatePistachioVault(updated)
        return { vault: activeVault }
    }
    if (operation === 'removePasskeyWrap') {
        requireWallet()
        if (!activeVault || !dek || activeVault.keyWraps.length <= 1 || message.backupAcknowledged !== true) {
            throw new TypeError('The last passkey wrap cannot be removed without recovery backup evidence.')
        }
        const remaining = activeVault.keyWraps.filter((item) => item.id !== message.keyWrapId)
        if (remaining.length === activeVault.keyWraps.length) throw new TypeError('Passkey wrap not found.')
        let nextVault = { ...activeVault, keyWraps: remaining, updatedAt: new Date().toISOString() }
        nextVault = { ...nextVault, encryptedPayload: await encryptPayload({ vault: nextVault, payload, dek }) }
        activeVault = validatePistachioVault(nextVault)
        return { vault: activeVault }
    }
    if (operation === 'exportEncryptedBackup') {
        return { backup: JSON.stringify(validatePistachioVault(activeVault), null, 2) }
    }
    if (operation === 'exportKeystore') {
        return { keystore: await requireWallet().encrypt(String(message.password ?? '')) }
    }
    if (operation === 'revealRecoveryPhrase') {
        if (payload?.kind !== 'mnemonic') throw new TypeError('This wallet has no recovery phrase.')
        const entropy = base64UrlToBytes(payload.entropy, 16)
        try {
            return { recoveryPhrase: Mnemonic.fromEntropy(entropy).phrase }
        } finally {
            entropy.fill(0)
        }
    }
    if (operation === 'revealPrivateKey') return { privateKey: requireWallet().privateKey }
    if (operation === 'lock' || operation === 'destroy') {
        clearSecrets()
        return { locked: true }
    }
    throw new TypeError('Unknown wallet worker operation.')
}

self.addEventListener('message', async (event) => {
    let request
    const requestId = Number.isSafeInteger(event.data?.id) ? event.data.id : 0
    try {
        request = validateWorkerRequest(event.data)
        const result = await handle(request.operation, request.payload)
        self.postMessage(workerResponse(request.id, result))
        if (request.operation === 'destroy') self.close()
    } catch (error) {
        self.postMessage(workerError(request?.id ?? requestId, error))
    }
})
