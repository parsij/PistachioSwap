import { pistachioError } from './passkeyErrors.js'

function isLocalhost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function assertPasskeyContext(windowImpl = globalThis.window) {
    if (!windowImpl || windowImpl.top !== windowImpl.self) {
        throw pistachioError('PISTACHIO_PASSKEY_IFRAME_BLOCKED')
    }
    if (!windowImpl.isSecureContext && !isLocalhost(windowImpl.location.hostname)) {
        throw pistachioError('PISTACHIO_PASSKEY_INSECURE_CONTEXT')
    }
}

export function resolvePistachioRpId({
    location = globalThis.location,
    stagingRpId = import.meta.env.VITE_PISTACHIO_PASSKEY_STAGING_RP_ID,
} = {}) {
    const hostname = String(location?.hostname ?? '').toLowerCase().replace(/^\[|\]$/gu, '')
    if (isLocalhost(hostname)) return 'localhost'
    if (hostname === 'pistachioswap.com' || hostname.endsWith('.pistachioswap.com')) {
        return 'pistachioswap.com'
    }
    const approvedStaging = String(stagingRpId ?? '').trim().toLowerCase()
    if (approvedStaging && approvedStaging === hostname && !approvedStaging.includes(':')) {
        return approvedStaging
    }
    throw pistachioError('PISTACHIO_PASSKEY_INSECURE_CONTEXT', 'This hostname is not approved for Pistachio Wallet passkeys.')
}

export async function detectPasskeyCapabilities(windowImpl = globalThis.window) {
    const PublicKeyCredentialImpl = windowImpl?.PublicKeyCredential
    const webAuthnAvailable = Boolean(PublicKeyCredentialImpl && windowImpl?.navigator?.credentials)
    if (!webAuthnAvailable) {
        return Object.freeze({ webAuthnAvailable: false, capabilityHintAvailable: false, prfHint: null })
    }
    if (typeof PublicKeyCredentialImpl.getClientCapabilities !== 'function') {
        return Object.freeze({ webAuthnAvailable: true, capabilityHintAvailable: false, prfHint: null })
    }
    try {
        const capabilities = await PublicKeyCredentialImpl.getClientCapabilities()
        return Object.freeze({
            webAuthnAvailable: true,
            capabilityHintAvailable: true,
            prfHint: typeof capabilities?.prf === 'boolean' ? capabilities.prf : null,
        })
    } catch {
        return Object.freeze({ webAuthnAvailable: true, capabilityHintAvailable: false, prfHint: null })
    }
}

export const passkeyCapabilityInternals = { isLocalhost }
