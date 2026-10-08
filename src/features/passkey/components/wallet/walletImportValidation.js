import { LangEn, Mnemonic } from 'ethers'

export const RECOVERY_WORD_COUNTS = Object.freeze([12, 15, 18, 21, 24])
const englishWords = new Set(Array.from({ length: 2048 }, (_, index) => LangEn.wordlist().getWord(index)))
const PRIVATE_KEY_LIMIT = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

export function normalizeRecoveryWord(value) {
    return value.normalize('NFKD').trim().toLowerCase()
}

export function isRecoveryWord(value) {
    return englishWords.has(normalizeRecoveryWord(value))
}

export function validateRecoveryWords(words) {
    if (!RECOVERY_WORD_COUNTS.includes(words.length) || words.some((word) => !isRecoveryWord(word))) {
        return { valid: false, error: '' }
    }
    if (!Mnemonic.isValidMnemonic(words.map(normalizeRecoveryWord).join(' '))) {
        return { valid: false, error: 'These words do not form a valid recovery phrase. Check their order and the last word.' }
    }
    return { valid: true, error: '' }
}

export function validatePrivateKey(value) {
    const key = value.trim()
    if (!key) return { valid: false, error: '' }
    if (!/^(?:0x)?[0-9a-f]{64}$/iu.test(key)) {
        return { valid: false, error: 'Enter exactly 64 hexadecimal characters, with or without 0x.' }
    }
    const scalar = BigInt(/^0x/iu.test(key) ? key : `0x${key}`)
    if (scalar === 0n || scalar >= PRIVATE_KEY_LIMIT) {
        return { valid: false, error: 'This private key is outside the valid range. Check the key and try again.' }
    }
    return { valid: true, error: '' }
}
