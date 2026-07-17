import { createEncryptedVault, decryptEncryptedVault } from './vaultCrypto.js'
import { wipeBytes } from './passkeyEncoding.js'

const FAKE_ADDRESS = '0x000000000000000000000000000000000000dEaD'
const FAKE_PAYLOAD = Object.freeze({ diagnostic: 'pistachio-passkey-vault-test-v1' })

self.addEventListener('message', async (event) => {
    const { id, operation, payload = {} } = event.data ?? {}
    const prf = payload.prfOutput instanceof ArrayBuffer ? new Uint8Array(payload.prfOutput) : null
    try {
        if (!Number.isSafeInteger(id) || !['encrypt', 'unlock'].includes(operation) || prf?.byteLength !== 32) {
            throw new TypeError('Invalid diagnostic worker request.')
        }
        if (operation === 'encrypt') {
            const result = await createEncryptedVault({
                vaultId: payload.vaultId,
                address: FAKE_ADDRESS,
                rpId: payload.keyWrap.rpId,
                sourceType: 'imported-private-key',
                derivationPath: null,
                payload: FAKE_PAYLOAD,
                keyWrap: payload.keyWrap,
                prfOutput: prf,
            })
            wipeBytes(result.dek)
            self.postMessage({ id, ok: true, result: { vault: result.vault } })
        } else {
            const result = await decryptEncryptedVault({
                vault: payload.vault,
                keyWrapId: payload.keyWrapId,
                prfOutput: prf,
            })
            const passed = result.payload?.diagnostic === FAKE_PAYLOAD.diagnostic
            wipeBytes(result.dek)
            if (!passed) throw new TypeError('Diagnostic payload mismatch.')
            self.postMessage({ id, ok: true, result: { passed: true } })
        }
    } catch {
        self.postMessage({ id, ok: false, error: { code: 'PISTACHIO_DIAGNOSTIC_FAILED', message: 'Passkey vault diagnostic failed.' } })
    } finally {
        wipeBytes(prf)
        self.close()
    }
})
