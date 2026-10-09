import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { HDNodeWallet, Mnemonic, verifyMessage, Transaction } from 'ethers'
import { bytesToBase64Url } from './passkeyEncoding.js'

let listener
let nextId = 0
const responses = new Map()
async function request(operation, payload = {}) {
    const id = ++nextId
    await listener({ data: { id, operation, payload } })
    const response = responses.get(id)
    responses.delete(id)
    if (!response.ok) throw Object.assign(new Error(response.error.message), { code: response.error.code })
    return response.result
}
const phrase = 'test test test test test test test test test test test junk'
const prf = new Uint8Array(32).fill(7)
const keyWrap = { id: '00000000-0000-4000-8000-000000000002', credentialId: bytesToBase64Url(new Uint8Array([1])), credentialTransports: ['internal'], rpId: 'localhost', prfInput: bytesToBase64Url(new Uint8Array(32).fill(1)), hkdfSalt: bytesToBase64Url(new Uint8Array(32).fill(2)), wrapIv: null, wrappedDek: null, label: 'Test', createdAt: '2026-01-01T00:00:00.000Z', prfVerified: true }
async function seedVault(mnemonic = phrase) {
    await request('lock')
    await request('setSetupPasskey', { keyWrap, prfOutput: prf.slice() })
    const imported = await request('importMnemonic', { mnemonic })
    const { vault } = await request('encryptVault', { vaultId: '00000000-0000-4000-8000-000000000001' })
    await request('verifyPersistedVault', { vault })
    return { vault, address: imported.address }
}
async function unlock(vault, accountIndex = 0, operation = 'unlockVault') {
    return request(operation, { vault, accountIndex, keyWrapId: keyWrap.id, prfOutput: prf.slice() })
}
beforeAll(async () => {
    vi.stubGlobal('self', { addEventListener: (_name, handler) => { listener = handler }, postMessage: (response) => responses.set(response.id, response), close: () => {} })
    await import('./walletWorker.js')
})
afterAll(async () => { await request('destroy'); vi.unstubAllGlobals() })
describe('real worker derived wallets', () => {
    it('keeps old v1 vaults valid, stages safely, signs with the selected account and survives lock/reload', async () => {
        const { vault, address } = await seedVault()
        expect(vault.accounts).toBeUndefined()
        const candidate = await request('createDerivedAccount')
        const second = HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/60'/0'/0/1").address
        expect(candidate.address).toBe(second)
        expect(candidate.vault.address).toBe(address)
        expect((await request('getAddress')).address).toBe(address)
        await request('adoptDerivedAccounts', { vault: structuredClone(candidate.vault), accountIndex: 1 })
        expect((await request('getAddress')).address).toBe(second)
        const { signature } = await request('signMessage', { message: 'Selected wallet test' })
        expect(verifyMessage('Selected wallet test', signature)).toBe(second)
        const transaction = { chainId: 8453, type: 2, from: second, to: address, nonce: 0, gasLimit: 21000n, maxFeePerGas: 100000000n, maxPriorityFeePerGas: 1n, value: 1n }
        const { signedTransaction } = await request('signTransaction', { transaction, mode: 'normal' })
        expect(Transaction.from(signedTransaction).from).toBe(second)
        await expect(request('signTransaction', { transaction: { ...transaction, from: address }, mode: 'normal' })).rejects.toThrow('account mismatch')
        await request('lock')
        expect((await unlock(candidate.vault, 1)).address).toBe(second)
        expect((await unlock(candidate.vault, 1, 'verifyExistingPasskey')).address).toBe(second)
        const backupWrap = { ...keyWrap, id: '00000000-0000-4000-8000-000000000003', credentialId: bytesToBase64Url(new Uint8Array([2])) }
        const wrapped = await request('addPasskeyWrap', { keyWrap: backupWrap, prfOutput: prf.slice() })
        expect((await request('getAddress')).address).toBe(second)
        expect(wrapped.vault.accounts).toEqual(candidate.vault.accounts)
        expect((await request('revealRecoveryPhrase')).recoveryPhrase).toBe(phrase)
        expect(JSON.parse((await request('exportEncryptedBackup')).backup).accounts).toEqual(candidate.vault.accounts)
        const third = await request('createDerivedAccount')
        expect(third.index).toBe(2)
        expect(third.address).toBe(HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/60'/0'/0/2").address)
        await request('lock')
        expect((await unlock(candidate.vault, 0)).address).toBe(address)
    })
    it('rejects address/index metadata tampering and nonexistent account selection', async () => {
        await seedVault()
        const { vault } = await request('createDerivedAccount')
        const tampered = structuredClone(vault)
        tampered.accounts[1].address = '0x0000000000000000000000000000000000000001'
        await expect(unlock(tampered, 1)).rejects.toThrow()
        await expect(unlock(vault, 2)).rejects.toThrow()
        await expect(unlock(vault, -1)).rejects.toThrow()
        await expect(unlock(vault, 0.5)).rejects.toThrow()
        expect((await unlock(vault, 1)).verified).toBe(true)
    })
    it.each([20, 24, 28, 32])('restores and derives accounts from %i-byte BIP39 entropy', async (bytes) => {
        const mnemonic = Mnemonic.fromEntropy(new Uint8Array(bytes).fill(5)).phrase
        const { vault, address } = await seedVault(mnemonic)
        await request('lock')
        expect((await unlock(vault)).address).toBe(address)
        expect((await request('revealRecoveryPhrase')).recoveryPhrase).toBe(mnemonic)
        expect((await request('createDerivedAccount')).address).toBe(HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/1").address)
    })
    it('refuses derivation from a private-key import', async () => {
        await request('lock')
        await request('setSetupPasskey', { keyWrap, prfOutput: prf.slice() })
        await request('importPrivateKey', { privateKey: `0x${'11'.repeat(32)}` })
        await request('encryptVault', { vaultId: '00000000-0000-4000-8000-000000000001' })
        await expect(request('createDerivedAccount')).rejects.toThrow('recovery phrase')
    })
})
