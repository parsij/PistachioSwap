import {
    base64UrlToBytes,
    bytesToBase64Url,
    randomBytes,
    toUint8Array,
} from './passkeyEncoding.js'
import {
    assertPasskeyContext,
    detectPasskeyCapabilities,
    resolvePistachioRpId,
} from './passkeyCapabilities.js'
import {
    normalizePasskeyError,
    pistachioError,
} from './passkeyErrors.js'

const PASSKEY_TIMEOUT_MS = 120_000

function requireCredential(value, PublicKeyCredentialImpl) {
    if (!value || !(value instanceof PublicKeyCredentialImpl)) {
        throw pistachioError('PISTACHIO_PASSKEY_NOT_AVAILABLE')
    }
    return value
}

function extractPrfResult(credential) {
    const result = credential.getClientExtensionResults?.()?.prf?.results?.first
    if (!result) throw pistachioError('PISTACHIO_PASSKEY_PRF_RESULT_MISSING')
    try {
        const bytes = toUint8Array(result)
        if (bytes.byteLength !== 32) throw new TypeError('Unexpected PRF length.')
        return bytes.slice().buffer
    } catch (error) {
        throw pistachioError('PISTACHIO_PASSKEY_PRF_RESULT_MISSING', undefined, error)
    }
}

async function evaluatePrf({ credentialId, prfInput, rpId, windowImpl }) {
    const rawCredentialId = base64UrlToBytes(credentialId)
    const assertion = requireCredential(
        await windowImpl.navigator.credentials.get({
            publicKey: {
                challenge: randomBytes(32, windowImpl.crypto),
                rpId,
                allowCredentials: [{ type: 'public-key', id: rawCredentialId }],
                userVerification: 'required',
                timeout: PASSKEY_TIMEOUT_MS,
                extensions: {
                    prf: {
                        evalByCredential: {
                            [credentialId]: { first: base64UrlToBytes(prfInput, 32) },
                        },
                    },
                },
            },
        }),
        windowImpl.PublicKeyCredential,
    )
    if (bytesToBase64Url(assertion.rawId) !== credentialId) {
        throw pistachioError('PISTACHIO_PASSKEY_NOT_AVAILABLE')
    }
    return extractPrfResult(assertion)
}

/**
 * Registers a discoverable WebAuthn credential and returns verified PRF material for a new key wrap.
 * @returns {Promise<object>} Credential metadata, PRF output, and relying-party binding.
 * @throws Normalized passkey errors for unsupported contexts, rejection, or missing PRF output.
 * @sideEffects Invokes `navigator.credentials.create`, which displays platform authenticator UI.
 */
export async function registerPrfPasskey({
    label = 'Primary passkey',
    walletIdentifier = 'pistachio-wallet',
    windowImpl = globalThis.window,
    rpId = resolvePistachioRpId({ location: windowImpl?.location }),
} = {}) {
    assertPasskeyContext(windowImpl)
    const capabilities = await detectPasskeyCapabilities(windowImpl)
    if (!capabilities.webAuthnAvailable) {
        throw pistachioError('PISTACHIO_PASSKEY_PRF_UNSUPPORTED')
    }
    const prfInput = randomBytes(32, windowImpl.crypto)
    try {
        const credential = requireCredential(
            await windowImpl.navigator.credentials.create({
                publicKey: {
                    rp: { id: rpId, name: 'PistachioSwap' },
                    user: {
                        id: randomBytes(32, windowImpl.crypto),
                        name: String(walletIdentifier).slice(0, 64),
                        displayName: 'Pistachio Wallet',
                    },
                    challenge: randomBytes(32, windowImpl.crypto),
                    pubKeyCredParams: [
                        { type: 'public-key', alg: -7 },
                        { type: 'public-key', alg: -257 },
                    ],
                    timeout: PASSKEY_TIMEOUT_MS,
                    authenticatorSelection: {
                        residentKey: 'required',
                        userVerification: 'required',
                    },
                    attestation: 'none',
                    extensions: {
                        prf: { eval: { first: prfInput } },
                        credProps: true,
                    },
                },
            }),
            windowImpl.PublicKeyCredential,
        )
        const registrationPrf = credential.getClientExtensionResults?.()?.prf
        if (registrationPrf?.enabled !== true) {
            throw pistachioError('PISTACHIO_PASSKEY_PRF_UNSUPPORTED')
        }
        const credentialId = bytesToBase64Url(credential.rawId)
        const encodedPrfInput = bytesToBase64Url(prfInput)
        const prfOutput = registrationPrf.results?.first
            ? extractPrfResult(credential)
            : await evaluatePrf({ credentialId, prfInput: encodedPrfInput, rpId, windowImpl })
        const transports = credential.response?.getTransports?.() ?? []
        return {
            keyWrap: {
                id: windowImpl.crypto.randomUUID(),
                credentialId,
                credentialTransports: transports.filter((item) => typeof item === 'string'),
                rpId,
                prfInput: encodedPrfInput,
                hkdfSalt: bytesToBase64Url(randomBytes(32, windowImpl.crypto)),
                wrapIv: null,
                wrappedDek: null,
                label: String(label).trim().slice(0, 80) || 'Passkey',
                createdAt: new Date().toISOString(),
                prfVerified: true,
            },
            prfOutput,
            capabilities,
        }
    } catch (error) {
        if (error?.code === 'PISTACHIO_PASSKEY_PRF_UNSUPPORTED') throw error
        throw normalizePasskeyError(error, 'PISTACHIO_PASSKEY_PRF_UNSUPPORTED')
    } finally {
        prfInput.fill(0)
    }
}

/**
 * Requests a WebAuthn assertion for one vault key wrap and returns its PRF output.
 * @sideEffects Invokes `navigator.credentials.get`, displaying authenticator UI.
 * @security Credential ID, RP ID, and expected PRF result are bound to the validated vault record.
 */
export async function getPrfForVaultWrap({ vault, keyWrapId, windowImpl = globalThis.window }) {
    assertPasskeyContext(windowImpl)
    const currentRpId = resolvePistachioRpId({ location: windowImpl.location })
    if (vault.rpId !== currentRpId) {
        throw pistachioError('PISTACHIO_WALLET_UNLOCK_FAILED')
    }
    const keyWrap = vault.keyWraps.find((candidate) => candidate.id === keyWrapId)
    if (!keyWrap || keyWrap.rpId !== currentRpId) {
        throw pistachioError('PISTACHIO_PASSKEY_NOT_AVAILABLE')
    }
    try {
        return await evaluatePrf({
            credentialId: keyWrap.credentialId,
            prfInput: keyWrap.prfInput,
            rpId: currentRpId,
            windowImpl,
        })
    } catch (error) {
        throw normalizePasskeyError(error)
    }
}

export const passkeyServiceInternals = { extractPrfResult, evaluatePrf }
