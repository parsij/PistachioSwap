import { describe, expect, it, vi } from 'vitest'

import { bytesToBase64Url } from './passkeyEncoding.js'
import { getPrfForVaultWrap, registerPrfPasskey } from './passkeyService.js'

function fakeWindow({ createOutput = null, enabled = true, output = new Uint8Array(32).fill(7), createError, getError } = {}) {
    class FakeCredential {
        constructor(kind) {
            this.kind = kind
            this.rawId = new Uint8Array([1, 2, 3, 4]).buffer
            this.response = { getTransports: () => ['internal'] }
        }
        getClientExtensionResults() {
            return this.kind === 'create'
                ? { prf: { enabled, ...(createOutput ? { results: { first: createOutput.slice().buffer } } : {}) } }
                : { prf: { results: output ? { first: output.slice().buffer } : {} } }
        }
    }
    FakeCredential.getClientCapabilities = vi.fn().mockResolvedValue({ prf: true })
    const windowImpl = {
        isSecureContext: true,
        location: { hostname: 'localhost' },
        crypto,
        PublicKeyCredential: FakeCredential,
        navigator: {
            credentials: {
                create: vi.fn().mockImplementation(async () => { if (createError) throw createError; return new FakeCredential('create') }),
                get: vi.fn().mockImplementation(async () => { if (getError) throw getError; return new FakeCredential('get') }),
            },
        },
    }
    windowImpl.top = windowImpl.self = windowImpl
    return windowImpl
}

describe('Pistachio WebAuthn PRF service', () => {
    it('uses one assertion when registration reports support without returning a PRF result', async () => {
        const windowImpl = fakeWindow()
        const result = await registerPrfPasskey({ windowImpl })
        expect(result.keyWrap).toMatchObject({ rpId: 'localhost', prfVerified: true, credentialTransports: ['internal'] })
        expect(result.prfOutput.byteLength).toBe(32)
        expect(windowImpl.navigator.credentials.get).toHaveBeenCalledOnce()
    })

    it('does not request another password when registration returns a valid PRF result', async () => {
        const windowImpl = fakeWindow({ createOutput: new Uint8Array(32).fill(9) })
        const result = await registerPrfPasskey({ windowImpl })
        expect(new Uint8Array(result.prfOutput)).toEqual(new Uint8Array(32).fill(9))
        expect(windowImpl.navigator.credentials.get).not.toHaveBeenCalled()
    })

    it('fails closed when registration reports PRF disabled', async () => {
        await expect(registerPrfPasskey({ windowImpl: fakeWindow({ enabled: false }) })).rejects.toMatchObject({ code: 'PISTACHIO_PASSKEY_PRF_UNSUPPORTED' })
    })

    it('rejects missing and incorrectly sized assertion output', async () => {
        await expect(registerPrfPasskey({ windowImpl: fakeWindow({ output: null }) })).rejects.toMatchObject({ code: 'PISTACHIO_PASSKEY_PRF_RESULT_MISSING' })
        await expect(registerPrfPasskey({ windowImpl: fakeWindow({ output: new Uint8Array(31) }) })).rejects.toMatchObject({ code: 'PISTACHIO_PASSKEY_PRF_RESULT_MISSING' })
    })

    it('maps user rejection and unavailable credentials to safe errors', async () => {
        const rejection = new DOMException('Denied', 'NotAllowedError')
        await expect(registerPrfPasskey({ windowImpl: fakeWindow({ createError: rejection }) })).rejects.toMatchObject({ code: 'PISTACHIO_PASSKEY_NOT_AVAILABLE' })
    })

    it('rejects malformed credential IDs and wrong RP IDs on unlock', async () => {
        const windowImpl = fakeWindow()
        await expect(getPrfForVaultWrap({ vault: { rpId: 'pistachioswap.com', keyWraps: [] }, keyWrapId: 'x', windowImpl })).rejects.toMatchObject({ code: 'PISTACHIO_WALLET_UNLOCK_FAILED' })
        const vault = { rpId: 'localhost', keyWraps: [{ id: 'x', credentialId: 'bad*', prfInput: bytesToBase64Url(new Uint8Array(32)), rpId: 'localhost' }] }
        await expect(getPrfForVaultWrap({ vault, keyWrapId: 'x', windowImpl })).rejects.toMatchObject({ code: 'PISTACHIO_WALLET_UNLOCK_FAILED' })
    })
})
