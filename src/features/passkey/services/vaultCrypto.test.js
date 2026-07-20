import { describe, expect, it } from 'vitest'

import { base64UrlToBytes, bytesToBase64Url } from './passkeyEncoding.js'
import {
    addEncryptedKeyWrap,
    createEncryptedVault,
    decryptEncryptedVault,
    deriveKek,
} from './vaultCrypto.js'

const ADDRESS = '0x000000000000000000000000000000000000dEaD'
const PRF_A = new Uint8Array(32).fill(11)
const PRF_B = new Uint8Array(32).fill(22)
const payload = { kind: 'private-key', privateKey: bytesToBase64Url(new Uint8Array(32).fill(33)), sourceType: 'imported-private-key' }

function keyWrap(id, credentialByte) {
    return {
        id,
        credentialId: bytesToBase64Url(new Uint8Array([credentialByte])),
        credentialTransports: ['internal'],
        rpId: 'localhost',
        prfInput: bytesToBase64Url(new Uint8Array(32).fill(credentialByte)),
        hkdfSalt: bytesToBase64Url(new Uint8Array(32).fill(credentialByte + 1)),
        wrapIv: null,
        wrappedDek: null,
        label: 'Test passkey',
        createdAt: '2026-01-01T00:00:00.000Z',
        prfVerified: true,
    }
}

async function vaultFixture() {
    return createEncryptedVault({
        vaultId: '00000000-0000-4000-8000-000000000001',
        address: ADDRESS,
        rpId: 'localhost',
        sourceType: 'imported-private-key',
        derivationPath: null,
        payload,
        keyWrap: keyWrap('00000000-0000-4000-8000-000000000002', 1),
        prfOutput: PRF_A,
        now: '2026-01-01T00:00:00.000Z',
    })
}

describe('Pistachio envelope encryption', () => {
    it('round trips with the same PRF and stored HKDF parameters', async () => {
        const created = await vaultFixture()
        const decrypted = await decryptEncryptedVault({ vault: created.vault, keyWrapId: created.vault.keyWraps[0].id, prfOutput: PRF_A })
        expect(decrypted.payload).toEqual(payload)
        created.dek.fill(0)
        decrypted.dek.fill(0)
    })

    it('uses non-extractable deterministic KEKs with domain separation', async () => {
        const parameters = { prfOutput: PRF_A, hkdfSalt: bytesToBase64Url(new Uint8Array(32).fill(8)), vaultId: 'vault-a', rpId: 'localhost' }
        const first = await deriveKek(parameters)
        const second = await deriveKek(parameters)
        expect(first.extractable).toBe(false)
        const iv = new Uint8Array(12)
        const plaintext = new Uint8Array([1, 2, 3])
        const left = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, first, plaintext))
        const right = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, second, plaintext))
        expect(left).toEqual(right)
        const separated = await deriveKek({ ...parameters, vaultId: 'vault-b' })
        const other = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, separated, plaintext))
        expect(other).not.toEqual(left)
    })

    it.each(['address', 'chainId', 'sourceType', 'updatedAt'])('rejects authenticated metadata tampering: %s', async (field) => {
        const created = await vaultFixture()
        const values = { address: '0x0000000000000000000000000000000000000001', chainId: 57, sourceType: 'imported-keystore', updatedAt: '2026-01-02T00:00:00.000Z' }
        await expect(decryptEncryptedVault({ vault: { ...created.vault, [field]: values[field] }, keyWrapId: created.vault.keyWraps[0].id, prfOutput: PRF_A })).rejects.toThrow()
        created.dek.fill(0)
    })

    it('rejects passkey label and transport metadata tampering', async () => {
        const created = await vaultFixture()
        const changedWrap = { ...created.vault.keyWraps[0], label: 'Tampered', credentialTransports: ['usb'] }
        const tampered = { ...created.vault, keyWraps: [changedWrap] }
        await expect(decryptEncryptedVault({ vault: tampered, keyWrapId: changedWrap.id, prfOutput: PRF_A })).rejects.toMatchObject({ code: 'PISTACHIO_WALLET_UNLOCK_FAILED' })
        created.dek.fill(0)
    })

    it('rejects ciphertext tampering and wrong passkey output', async () => {
        const created = await vaultFixture()
        const ciphertext = base64UrlToBytes(created.vault.encryptedPayload.ciphertext)
        ciphertext[0] ^= 1
        const tampered = { ...created.vault, encryptedPayload: { ...created.vault.encryptedPayload, ciphertext: bytesToBase64Url(ciphertext) } }
        await expect(decryptEncryptedVault({ vault: tampered, keyWrapId: tampered.keyWraps[0].id, prfOutput: PRF_A })).rejects.toMatchObject({ code: 'PISTACHIO_WALLET_UNLOCK_FAILED' })
        await expect(decryptEncryptedVault({ vault: created.vault, keyWrapId: created.vault.keyWraps[0].id, prfOutput: PRF_B })).rejects.toMatchObject({ code: 'PISTACHIO_WALLET_UNLOCK_FAILED' })
        created.dek.fill(0)
    })

    it('supports a second independently derived passkey wrap and prevents cross-wrap output use', async () => {
        const created = await vaultFixture()
        const second = keyWrap('00000000-0000-4000-8000-000000000003', 2)
        const vault = await addEncryptedKeyWrap({ vault: created.vault, payload, dek: created.dek, keyWrap: second, prfOutput: PRF_B })
        const unlocked = await decryptEncryptedVault({ vault, keyWrapId: second.id, prfOutput: PRF_B })
        expect(unlocked.payload).toEqual(payload)
        await expect(decryptEncryptedVault({ vault, keyWrapId: second.id, prfOutput: PRF_A })).rejects.toMatchObject({ code: 'PISTACHIO_WALLET_UNLOCK_FAILED' })
        created.dek.fill(0)
        unlocked.dek.fill(0)
    })

    it('does not reuse payload or wrapping IVs', async () => {
        const first = await vaultFixture()
        const second = await vaultFixture()
        expect(first.vault.encryptedPayload.iv).not.toBe(second.vault.encryptedPayload.iv)
        expect(first.vault.keyWraps[0].wrapIv).not.toBe(second.vault.keyWraps[0].wrapIv)
        first.dek.fill(0)
        second.dek.fill(0)
    })
})
