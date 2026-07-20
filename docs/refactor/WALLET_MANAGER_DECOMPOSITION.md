# Wallet Manager Decomposition

## Public Boundary

`src/features/passkey/services/walletManager.js` remains the stable facade and re-exports `PistachioWalletManager`, `getPistachioWalletManager`, and `walletManagerInternals` unchanged. Existing UI and connector imports continue to resolve through this path.

## Current Internal Core

The implementation is preserved in `src/features/passkey/services/walletManagerCore.js`. It is a tightly coupled state machine spanning initialization, setup, vault selection, passkey delegation, worker lifecycle, inactivity locking, connection promises, signing review, transaction validation, and provider requests. These operations share mutable fields and strict sequencing; moving individual methods without characterization coverage risks changing lock timing, cleanup, or security boundaries.

| Responsibility | Current methods | State/side effects | Safe boundary |
| --- | --- | --- | --- |
| Initialization and subscriptions | `initialize`, `subscribe`, `notify`, `snapshot` | storage reads, subscribers, phases | core state machine |
| Setup/import | `prepareNewWallet`, `beginPasskeySetup`, `createMnemonicWallet`, `importMnemonic`, `importPrivateKey`, `importKeystore`, `persistPendingWallet`, `finishOnboarding` | worker, passkey, encrypted vault writes | core; crypto/storage services remain canonical |
| Unlock/session | `unlock`, `markUnlocked`, `lock`, `disconnect`, `clearActiveSession`, `resetAutoLock`, `recordActivity` | worker secret state, timers, preferences, broadcast | core due ordering |
| Saved vaults | `selectVault`, `refreshVaults`, `renameSavedVault`, `exportStoredVaultBackup`, `deleteLocalVault` | vault storage and metadata | core delegates existing vaultStorage |
| Signing/provider | `review`, `signMessage`, `signTypedData`, `signMegaFuelTransaction`, `sendTransaction`, `providerRequest` | signing queue, RPC/provider calls | core delegates existing validation/review services |
| Passkeys/backups | `reauthenticate`, `addBackupPasskey`, `renamePasskey`, `removePasskey`, `exportEncryptedBackup`, `exportKeystore`, `revealRecoveryPhrase`, `revealPrivateKey` | passkey/worker and sensitive transient values | core delegates existing passkey/worker services |

## Singleton and Storage Contracts

The singleton remains keyed by `Symbol.for('pistachioswap.pistachio-wallet.manager')`. Storage keys include `activeSessionVaultId`, `lastWalletActivityAt`, `sessionResumeEligible`, and existing vault-storage keys. No payload format, schema, encryption parameter, derivation path, or preference value was changed.

## Tests and Limitations

`src/features/passkey/services/walletManager.test.js` and the existing passkey service, vault, worker, signing, and connector suites are characterization coverage. They use mocked workers, storage, crypto, and browser APIs; they do not prove real WebAuthn, secure storage, encryption, key derivation, or signing.

The core is intentionally over the preferred module size because it is the existing coupled state machine. The next safe decomposition requires method-level characterization tests before moving session, signing, or setup transitions into services.
