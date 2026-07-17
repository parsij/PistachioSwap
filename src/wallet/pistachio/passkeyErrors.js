export const PASSKEY_ERROR_MESSAGES = Object.freeze({
    PISTACHIO_PASSKEY_INSECURE_CONTEXT: 'Pistachio Wallet requires a secure browser context.',
    PISTACHIO_PASSKEY_IFRAME_BLOCKED: 'Pistachio Wallet cannot run inside an iframe.',
    PISTACHIO_PASSKEY_PRF_UNSUPPORTED: 'This browser or authenticator cannot protect Pistachio Wallet with WebAuthn PRF.',
    PISTACHIO_PASSKEY_NOT_AVAILABLE: 'The matching passkey is not available on this device.',
    PISTACHIO_PASSKEY_PRF_RESULT_MISSING: 'The passkey did not return the required PRF result.',
    PISTACHIO_WALLET_UNLOCK_FAILED: 'Pistachio Wallet could not be unlocked.',
    PISTACHIO_WALLET_STORAGE_FAILED: 'The encrypted wallet vault could not be stored safely.',
})

export function pistachioError(code, message = PASSKEY_ERROR_MESSAGES[code], cause) {
    const error = new Error(message ?? 'Pistachio Wallet operation failed.', cause ? { cause } : undefined)
    error.code = code
    return error
}

export function normalizePasskeyError(error, fallbackCode = 'PISTACHIO_WALLET_UNLOCK_FAILED') {
    if (error?.code && PASSKEY_ERROR_MESSAGES[error.code]) return error
    if (error?.name === 'NotAllowedError' || error?.name === 'InvalidStateError') {
        return pistachioError('PISTACHIO_PASSKEY_NOT_AVAILABLE')
    }
    return pistachioError(fallbackCode, undefined, error)
}
