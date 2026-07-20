# Wallet Manager

## Public Facade

Use `src/features/passkey/services/walletManager.js`. It preserves the public `PistachioWalletManager` class, `getPistachioWalletManager()` singleton accessor, and `walletManagerInternals` diagnostics export. UI code reaches it through `walletUIOperations.js`.

## Internal Implementation

`walletManagerCore.js` contains the existing coupled state machine. It owns initialization, vault selection, setup/import, unlock/lock, inactivity expiry, connection bridging, passkey delegation, signing review, provider requests, and cleanup. Existing lower-level boundaries remain `vaultStorage.js`, `vaultCrypto.js`, `passkeyService.js`, `walletWorkerClient.js`, `signingReview.js`, and `transactionValidation.js`.

## Security and Storage

Do not change vault schemas, storage keys, encryption parameters, derivation paths, passkey PRF inputs, signing serialization, or worker cleanup. Passwords, seed phrases, private keys, decrypted payloads, signatures, and raw transactions must not be logged or newly persisted.

## Flows

Initialization reads vault metadata and preferences, then publishes a snapshot. Unlock delegates passkey/worker operations and marks the session active. Lock terminates sensitive worker state, clears session preferences, and publishes the locked phase. Signing requests pass through the review queue and transaction validation before worker signing or provider submission.

## Tests

Use `src/features/passkey/services/walletManager.test.js` plus the vault, worker, passkey, signing, connector, and controller suites. These are mocked tests and do not prove real WebAuthn, encryption, secure storage, key derivation, recovery, or signing.

## Manual Changes

For a new public manager operation, add it to the core class, preserve the facade export path, characterize it with mocked dependencies, and document its state/storage/error effects before changing UI callers.
