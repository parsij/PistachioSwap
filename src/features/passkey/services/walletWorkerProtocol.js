export const WALLET_WORKER_OPERATIONS = Object.freeze([
    'setSetupPasskey',
    'createMnemonicWallet',
    'importMnemonic',
    'importPrivateKey',
    'importKeystore',
    'encryptVault',
    'verifyPersistedVault',
    'unlockVault',
    'verifyExistingPasskey',
    'getAddress',
    'signMessage',
    'signTypedData',
    'signTransaction',
    'addPasskeyWrap',
    'renamePasskeyWrap',
    'removePasskeyWrap',
    'exportEncryptedBackup',
    'exportKeystore',
    'revealRecoveryPhrase',
    'revealPrivateKey',
    'lock',
    'destroy',
])

const operationSet = new Set(WALLET_WORKER_OPERATIONS)

/** Validates and returns a supported passkey wallet worker request envelope. */
export function validateWorkerRequest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid wallet worker request.')
    if (!Number.isSafeInteger(value.id) || value.id < 1 || !operationSet.has(value.operation)) {
        throw new TypeError('Unknown wallet worker operation.')
    }
    if (!('payload' in value) || !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) {
        throw new TypeError('Invalid wallet worker payload.')
    }
    return value
}

/** Creates a successful worker response envelope for the matching request ID. */
export function workerResponse(id, result) {
    return { id, ok: true, result }
}

/** Creates a redacted worker error envelope that does not transfer secret material. */
export function workerError(id, error) {
    const unlockFailure = error?.code === 'PISTACHIO_WALLET_UNLOCK_FAILED'
    return {
        id,
        ok: false,
        error: {
            code: error?.code ?? 'PISTACHIO_WALLET_WORKER_FAILED',
            message: unlockFailure ? 'Pistachio Wallet could not be unlocked.' : String(error?.message ?? 'Wallet worker operation failed.'),
        },
    }
}

export const walletWorkerProtocolInternals = { operationSet }
