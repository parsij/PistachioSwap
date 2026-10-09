# Passkey Wallet Feature

## Purpose

Owns Pistachio Wallet passkey vault UI, connector, encrypted vault/session lifecycle, signing review, worker/client communication, and development diagnostics.

## Responsibilities and files

- `components/PistachioWalletController.jsx`: setup/import/restore/lock/unlock/account/signing-review UI.
- `components/PasskeyVaultTestPanel.jsx`: development-only passkey diagnostics.
- `services/pistachioConnector.js`: Wagmi connector boundary used by `src/web3/appKit.js`.
- `services/walletManager.js`: stable public facade over `services/walletManagerCore.js`.
- Other services: passkey capability/PRF, encryption/encoding, vault storage, signing review, wallet worker/client, validation, flags/constants.

## What does not belong here

Generic external-wallet UI, swap quotes, normal approvals, Gas Assist orchestration, or cross-chain route selection.

## Flow

`AppKit connector -> PistachioWalletManager snapshot -> controller screen -> create/import/restore -> passkey PRF -> encrypted vault storage -> unlock session -> request review -> explicit approval -> worker signing -> connector result`.

## Side effects, errors, logging, and security

The feature accesses WebAuthn/passkeys, IndexedDB/storage, workers, cryptographic material, downloads/backups, and signing requests. It must wipe sensitive byte arrays, keep private keys out of React state/logs, require explicit review, validate chain/transaction/typed data, and preserve connected-versus-unlocked semantics. Errors are sanitized by the controller and shown in feature notices.

## Tests and mocked limitations

Tests beside components/services mock WebAuthn, storage, crypto boundaries, workers, connectors, and wallet transport. They do not prove device authenticator UX, hardware-backed key protection, browser recovery, live signatures, or network acceptance.

## Common manual edits and technical debt

UI screens: controller; connector metadata: `pistachioConnector.js`; session/signing policy: manager/validation; flags: `featureFlags.js`. The wallet facade remains intentionally small while the coupled state machine is isolated in `walletManagerCore.js` for future characterized decomposition.
# Wallet UI Ownership

The wallet UI is composed by `components/PistachioWalletController.jsx`. The shell owns the manager snapshot subscription, modal portal, focus restoration, activity recording, and screen selection. Screen implementations are in `components/PistachioWalletScreens.jsx`: setup/onboarding, saved-wallet selection, unlocked management, locked-session recovery, and signing review.

Presentation remains coupled only to the existing `walletManager.js` boundary; no cryptographic or persistence logic is duplicated. Secret values are transient and remain in the setup/unlocked screen state or refs that already owned them. Focus traps, Escape handling, CSS classes, and diagnostics remain in the existing markup.

## UI Flow

`PistachioWalletButton` -> manager `open('wallet')` -> controller snapshot -> selected screen -> existing manager operation -> snapshot/error -> visible screen. Focused coverage is in `components/PistachioWalletController.test.jsx`; mocked tests do not prove WebAuthn, encryption, secure storage, key derivation, or signing.

Screen ownership is split under `components/wallet/`: setup/onboarding, saved wallets, unlocked management, locked session, signing review, and shared primitives. `services/walletUIOperations.js` is the only UI-facing manager adapter; it delegates to the unchanged canonical manager.

### Multiple accounts from one recovery phrase

The wallet picker creates contiguous EVM accounts at `m/44'/60'/0'/0/{index}`.
Account zero remains the vault's root address, so existing v1 vaults, passkey wraps,
and recovery phrases stay compatible. Optional public `accounts` metadata is
included in the encrypted payload's authenticated data. The seed, derived keys,
and signing stay inside the worker. Private-key and keystore imports support
one account; use another recovery phrase for additional derived wallets.

A new account is staged, saved with a compare-and-swap against the previous vault,
and decrypted/verified before selection. Account selection and reconnect state
are committed together in IndexedDB. Switching cancels signing reviews, invalidates
in-flight signatures and unlocks, discards the worker, and emits the selected
account through the connector. The next protected action requires a passkey.
Encrypted backups retain the account list. Phrase import previews its standard Ethereum accounts before saving. Choose an
address from the list or use Find wallet to search the first 100 accounts by full
address. The chosen index and preceding accounts are saved in the encrypted vault;
Create wallet continues that sequence. Other derivation paths and extra BIP-39
passphrases are not supported by this importer.

Implementation references reviewed (the implementation here uses the existing
Pistachio vault and UI, rather than importing their code):
- [Uniswap account switcher](https://github.com/Uniswap/interface/blob/main/apps/extension/src/app/features/accounts/AccountSwitcherScreen.tsx)
- [Uniswap account row](https://github.com/Uniswap/interface/blob/main/apps/extension/src/app/features/accounts/AccountItem.tsx)
- [MetaMask account creation and persistence](https://github.com/MetaMask/core/blob/main/packages/keyring-controller/src/KeyringController.ts)

Regression coverage includes real derived signatures, selected-account unlock,
longer BIP39 phrases, metadata tampering, backup passkeys, encrypted backups,
failed saves, stale writes, late unlocks, concurrent creation, provider events,
and reload selection.
