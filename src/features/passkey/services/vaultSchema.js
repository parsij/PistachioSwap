import { getAddress, isAddress } from 'viem'

import {
    PISTACHIO_CHAIN_ID,
    PISTACHIO_DERIVATION_PATH,
    PISTACHIO_SOURCE_TYPES,
    PISTACHIO_VAULT_SCHEMA_VERSION,
    PISTACHIO_WALLET_NAME,
} from './constants.js'
import { base64UrlToBytes } from './passkeyEncoding.js'

const VAULT_KEYS = new Set([
    'schemaVersion', 'vaultId', 'name', 'address', 'chainId', 'rpId', 'sourceType',
    'derivationPath', 'encryptedPayload', 'keyWraps', 'createdAt', 'updatedAt',
])
const WRAP_KEYS = new Set([
    'id', 'credentialId', 'credentialTransports', 'rpId', 'prfInput', 'hkdfSalt',
    'wrapIv', 'wrappedDek', 'label', 'createdAt', 'prfVerified',
])

function exactKeys(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).every((key) => keys.has(key)) &&
        [...keys].every((key) => key in value)
}

function isoDate(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function uuid(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

function validateKeyWrap(value) {
    if (!exactKeys(value, WRAP_KEYS) || !uuid(value.id) || !value.label || !isoDate(value.createdAt)) return false
    if (!Array.isArray(value.credentialTransports) || value.credentialTransports.some((item) => typeof item !== 'string')) return false
    if (typeof value.rpId !== 'string' || !value.rpId || value.prfVerified !== true) return false
    try {
        base64UrlToBytes(value.credentialId)
        base64UrlToBytes(value.prfInput, 32)
        base64UrlToBytes(value.hkdfSalt, 32)
        base64UrlToBytes(value.wrapIv, 12)
        base64UrlToBytes(value.wrappedDek, 48)
        return true
    } catch {
        return false
    }
}

/** Validates and returns the canonical encrypted vault schema, rejecting malformed or unsupported versions. */
export function validatePistachioVault(value) {
    if (!exactKeys(value, VAULT_KEYS)) throw new TypeError('Invalid Pistachio Wallet vault.')
    if (value.schemaVersion !== PISTACHIO_VAULT_SCHEMA_VERSION) throw new TypeError('Unsupported Pistachio Wallet vault schema.')
    if (!uuid(value.vaultId) || value.name !== PISTACHIO_WALLET_NAME || value.chainId !== PISTACHIO_CHAIN_ID) throw new TypeError('Invalid Pistachio Wallet metadata.')
    if (!isAddress(value.address) || getAddress(value.address) !== value.address) throw new TypeError('Invalid Pistachio Wallet address.')
    if (typeof value.rpId !== 'string' || !value.rpId || !PISTACHIO_SOURCE_TYPES.includes(value.sourceType)) throw new TypeError('Invalid Pistachio Wallet source.')
    const mnemonic = value.sourceType.endsWith('mnemonic')
    if (value.derivationPath !== (mnemonic ? PISTACHIO_DERIVATION_PATH : null)) throw new TypeError('Invalid Pistachio Wallet derivation path.')
    if (!isoDate(value.createdAt) || !isoDate(value.updatedAt)) throw new TypeError('Invalid Pistachio Wallet timestamps.')
    if (!exactKeys(value.encryptedPayload, new Set(['algorithm', 'iv', 'ciphertext'])) || value.encryptedPayload.algorithm !== 'AES-256-GCM') throw new TypeError('Invalid encrypted wallet payload.')
    try {
        base64UrlToBytes(value.encryptedPayload.iv, 12)
        base64UrlToBytes(value.encryptedPayload.ciphertext)
    } catch {
        throw new TypeError('Invalid encrypted wallet payload.')
    }
    if (!Array.isArray(value.keyWraps) || value.keyWraps.length < 1 || !value.keyWraps.every(validateKeyWrap)) throw new TypeError('Invalid Pistachio Wallet passkey wraps.')
    if (new Set(value.keyWraps.map((item) => item.id)).size !== value.keyWraps.length) throw new TypeError('Duplicate Pistachio Wallet passkey wrap.')
    if (value.keyWraps.some((item) => item.rpId !== value.rpId)) throw new TypeError('Mismatched Pistachio Wallet RP ID.')
    return structuredClone(value)
}

export const vaultSchemaInternals = { exactKeys, validateKeyWrap }
