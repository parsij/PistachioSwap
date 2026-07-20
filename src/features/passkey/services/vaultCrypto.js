import { getAddress } from 'viem'

import {
    PISTACHIO_CHAIN_ID,
    PISTACHIO_VAULT_SCHEMA_VERSION,
    PISTACHIO_WALLET_NAME,
} from './constants.js'
import {
    base64UrlToBytes,
    bytesToBase64Url,
    canonicalJson,
    decodeUtf8,
    randomBytes,
    toUint8Array,
    utf8,
    wipeBytes,
} from './passkeyEncoding.js'
import { pistachioError } from './passkeyErrors.js'
import { validatePistachioVault } from './vaultSchema.js'

function baseMetadata(vault) {
    return {
        schemaVersion: vault.schemaVersion,
        vaultId: vault.vaultId,
        name: vault.name,
        walletAddress: vault.address,
        chainId: vault.chainId,
        rpId: vault.rpId,
        sourceType: vault.sourceType,
        derivationPath: vault.derivationPath,
        createdAt: vault.createdAt,
    }
}

/** Builds canonical authenticated data binding ciphertext to immutable vault metadata. */
export function vaultPayloadAad(vault) {
    return utf8(canonicalJson({
        purpose: 'PistachioSwap/passkey-vault-payload/v1',
        ...baseMetadata(vault),
        updatedAt: vault.updatedAt,
        encryptionAlgorithm: vault.encryptedPayload?.algorithm ?? 'AES-256-GCM',
        keyWraps: vault.keyWraps,
    }))
}

/** Builds canonical authenticated data binding a wrapped key to its vault and credential metadata. */
export function keyWrapAad(vault, keyWrap) {
    return utf8(canonicalJson({
        purpose: 'PistachioSwap/passkey-vault-wrap/v1',
        ...baseMetadata(vault),
        credentialId: keyWrap.credentialId,
        keyWrapId: keyWrap.id,
    }))
}

/** Derives a non-extractable AES key-encryption key from passkey PRF material and vault context. */
export async function deriveKek({ prfOutput, hkdfSalt, vaultId, rpId, cryptoImpl = globalThis.crypto }) {
    const rawPrf = toUint8Array(prfOutput)
    if (rawPrf.byteLength !== 32) throw new TypeError('WebAuthn PRF output must be 32 bytes.')
    const inputKey = await cryptoImpl.subtle.importKey('raw', rawPrf, 'HKDF', false, ['deriveKey'])
    return cryptoImpl.subtle.deriveKey({
        name: 'HKDF',
        hash: 'SHA-256',
        salt: base64UrlToBytes(hkdfSalt, 32),
        info: utf8(`PistachioSwap/passkey-vault-wrap/v1/${vaultId}/${rpId}`),
    }, inputKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

async function importDek(dek, cryptoImpl, usages) {
    return cryptoImpl.subtle.importKey('raw', toUint8Array(dek), { name: 'AES-GCM' }, false, usages)
}

/** Encrypts a vault payload with AES-GCM and metadata-bound authenticated data. */
export async function encryptPayload({ vault, payload, dek, cryptoImpl = globalThis.crypto }) {
    const iv = randomBytes(12, cryptoImpl)
    const key = await importDek(dek, cryptoImpl, ['encrypt'])
    const ciphertext = await cryptoImpl.subtle.encrypt({
        name: 'AES-GCM',
        iv,
        additionalData: vaultPayloadAad(vault),
        tagLength: 128,
    }, key, utf8(canonicalJson(payload)))
    return {
        algorithm: 'AES-256-GCM',
        iv: bytesToBase64Url(iv),
        ciphertext: bytesToBase64Url(ciphertext),
    }
}

/** Decrypts and parses a vault payload, throwing when ciphertext or metadata authentication fails. */
export async function decryptPayload({ vault, dek, cryptoImpl = globalThis.crypto }) {
    try {
        const key = await importDek(dek, cryptoImpl, ['decrypt'])
        const plaintext = await cryptoImpl.subtle.decrypt({
            name: 'AES-GCM',
            iv: base64UrlToBytes(vault.encryptedPayload.iv, 12),
            additionalData: vaultPayloadAad(vault),
            tagLength: 128,
        }, key, base64UrlToBytes(vault.encryptedPayload.ciphertext))
        return JSON.parse(decodeUtf8(plaintext))
    } catch (error) {
        throw pistachioError('PISTACHIO_WALLET_UNLOCK_FAILED', undefined, error)
    }
}

/** Wraps a data-encryption key with passkey-derived material bound to one credential record. */
export async function wrapDek({ vault, keyWrap, dek, prfOutput, cryptoImpl = globalThis.crypto }) {
    const wrapIv = randomBytes(12, cryptoImpl)
    const kek = await deriveKek({
        prfOutput,
        hkdfSalt: keyWrap.hkdfSalt,
        vaultId: vault.vaultId,
        rpId: vault.rpId,
        cryptoImpl,
    })
    const wrapped = await cryptoImpl.subtle.encrypt({
        name: 'AES-GCM',
        iv: wrapIv,
        additionalData: keyWrapAad(vault, keyWrap),
        tagLength: 128,
    }, kek, toUint8Array(dek))
    return {
        ...keyWrap,
        wrapIv: bytesToBase64Url(wrapIv),
        wrappedDek: bytesToBase64Url(wrapped),
    }
}

/** Unwraps a vault data-encryption key after authenticating passkey-derived binding metadata. */
export async function unwrapDek({ vault, keyWrap, prfOutput, cryptoImpl = globalThis.crypto }) {
    try {
        const kek = await deriveKek({
            prfOutput,
            hkdfSalt: keyWrap.hkdfSalt,
            vaultId: vault.vaultId,
            rpId: vault.rpId,
            cryptoImpl,
        })
        const unwrapped = await cryptoImpl.subtle.decrypt({
            name: 'AES-GCM',
            iv: base64UrlToBytes(keyWrap.wrapIv, 12),
            additionalData: keyWrapAad(vault, keyWrap),
            tagLength: 128,
        }, kek, base64UrlToBytes(keyWrap.wrappedDek, 48))
        if (unwrapped.byteLength !== 32) throw new TypeError('Invalid DEK length.')
        return new Uint8Array(unwrapped)
    } catch (error) {
        throw pistachioError('PISTACHIO_WALLET_UNLOCK_FAILED', undefined, error)
    }
}

/**
 * Creates a versioned encrypted vault and initial passkey key-wrap record.
 * @returns {Promise<object>} Validated encrypted vault; plaintext key buffers are wiped on completion.
 * @throws For invalid input, unavailable crypto, or encryption/key-wrap failure.
 */
export async function createEncryptedVault({
    vaultId,
    address,
    rpId,
    sourceType,
    derivationPath,
    payload,
    keyWrap,
    prfOutput,
    cryptoImpl = globalThis.crypto,
    now = new Date().toISOString(),
}) {
    const dek = randomBytes(32, cryptoImpl)
    const baseVault = {
        schemaVersion: PISTACHIO_VAULT_SCHEMA_VERSION,
        vaultId,
        name: PISTACHIO_WALLET_NAME,
        address: getAddress(address),
        chainId: PISTACHIO_CHAIN_ID,
        rpId,
        sourceType,
        derivationPath,
        encryptedPayload: null,
        keyWraps: [keyWrap],
        createdAt: now,
        updatedAt: now,
    }
    try {
        const wrappedKey = await wrapDek({ vault: baseVault, keyWrap, dek, prfOutput, cryptoImpl })
        const vaultWithWrap = { ...baseVault, keyWraps: [wrappedKey] }
        const encryptedPayload = await encryptPayload({ vault: vaultWithWrap, payload, dek, cryptoImpl })
        const vault = validatePistachioVault({ ...vaultWithWrap, encryptedPayload })
        return { vault, dek: dek.slice() }
    } finally {
        wipeBytes(dek)
    }
}

/** Decrypts a validated vault through the selected key wrap and returns payload plus ephemeral DEK. */
export async function decryptEncryptedVault({ vault: input, keyWrapId, prfOutput, cryptoImpl = globalThis.crypto }) {
    const vault = validatePistachioVault(input)
    const keyWrap = vault.keyWraps.find((candidate) => candidate.id === keyWrapId)
    if (!keyWrap) throw pistachioError('PISTACHIO_WALLET_UNLOCK_FAILED')
    const dek = await unwrapDek({ vault, keyWrap, prfOutput, cryptoImpl })
    try {
        const payload = await decryptPayload({ vault, dek, cryptoImpl })
        return { payload, dek: dek.slice() }
    } finally {
        wipeBytes(dek)
    }
}

/** Adds a credential-bound encrypted key wrap while preserving and revalidating the vault payload. */
export async function addEncryptedKeyWrap({ vault: input, payload, dek, keyWrap, prfOutput, cryptoImpl = globalThis.crypto }) {
    const vault = validatePistachioVault(input)
    if (vault.keyWraps.some((candidate) => candidate.id === keyWrap.id || candidate.credentialId === keyWrap.credentialId)) {
        throw new TypeError('This passkey wrap already exists.')
    }
    const wrapped = await wrapDek({ vault, keyWrap, dek, prfOutput, cryptoImpl })
    const updated = {
        ...vault,
        keyWraps: [...vault.keyWraps, wrapped],
        updatedAt: new Date().toISOString(),
    }
    updated.encryptedPayload = await encryptPayload({ vault: updated, payload, dek, cryptoImpl })
    return validatePistachioVault(updated)
}

export const vaultCryptoInternals = { baseMetadata, importDek }
