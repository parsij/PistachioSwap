import { describe, expect, it, vi } from 'vitest'

import {
    assertPasskeyContext,
    detectPasskeyCapabilities,
    resolvePistachioRpId,
} from './passkeyCapabilities.js'

describe('Pistachio passkey capabilities', () => {
    it('rejects insecure non-local origins and iframes', () => {
        const top = {}
        expect(() => assertPasskeyContext({ top, self: {}, isSecureContext: true, location: { hostname: 'pistachioswap.com' } })).toThrowError(expect.objectContaining({ code: 'PISTACHIO_PASSKEY_IFRAME_BLOCKED' }))
        const windowImpl = { isSecureContext: false, location: { hostname: 'example.com' } }
        windowImpl.top = windowImpl.self = windowImpl
        expect(() => assertPasskeyContext(windowImpl)).toThrowError(expect.objectContaining({ code: 'PISTACHIO_PASSKEY_INSECURE_CONTEXT' }))
    })

    it('permits localhost and resolves isolated RP IDs without ports', () => {
        const windowImpl = { isSecureContext: false, location: { hostname: 'localhost' } }
        windowImpl.top = windowImpl.self = windowImpl
        expect(() => assertPasskeyContext(windowImpl)).not.toThrow()
        expect(resolvePistachioRpId({ location: { hostname: 'localhost', port: '5173' } })).toBe('localhost')
        expect(resolvePistachioRpId({ location: { hostname: 'app.pistachioswap.com' } })).toBe('pistachioswap.com')
        expect(resolvePistachioRpId({ location: { hostname: 'staging.example.net' }, stagingRpId: 'staging.example.net' })).toBe('staging.example.net')
    })

    it('reports unavailable WebAuthn and treats capability output as an optional hint', async () => {
        expect(await detectPasskeyCapabilities({ navigator: {} })).toEqual({ webAuthnAvailable: false, capabilityHintAvailable: false, prfHint: null })
        class PublicKeyCredential {}
        expect(await detectPasskeyCapabilities({ PublicKeyCredential, navigator: { credentials: {} } })).toEqual({ webAuthnAvailable: true, capabilityHintAvailable: false, prfHint: null })
        PublicKeyCredential.getClientCapabilities = vi.fn().mockResolvedValue({ prf: true })
        expect(await detectPasskeyCapabilities({ PublicKeyCredential, navigator: { credentials: {} } })).toEqual({ webAuthnAvailable: true, capabilityHintAvailable: true, prfHint: true })
    })
})
