# Passkey Components

## PistachioWalletController

The default export is the stateful modal controller mounted once by `SwapPage`; named `PistachioWalletButton` is rendered in `AppHeader`. The controller subscribes to `getPistachioWalletManager`, selects setup/saved/locked/unlocked/storage-error/signing-review views, and emits explicit manager operations.

It owns view navigation, sensitive-edit/exit confirmation, setup form state, and modal state. Vault/session/request state comes from the manager snapshot. Side effects include passkey prompts, encrypted storage, backup import/export, clipboard/download, lock/unlock, and explicit signing approval through services. Errors are sanitized before display.

Accessibility: preserve dialog semantics, labels, focus/Escape/exit-confirmation behavior, live errors, and disabled busy states. Styling is in `pistachioWallet.css`; tests assert important classes/hierarchy. Debug by inspecting manager snapshot, current phase/request, feature flags, storage error, passkey capability, and manager tests before UI.

## PistachioWalletButton

Named presentation entry point for AppKit/Pistachio wallet selection. It reads manager/controller context as currently implemented and opens the feature UI. Preserve its accessible name and connector behavior.

## PasskeyVaultTestPanel

Development-only diagnostic component for capability/PRF/encryption/storage checks. It must remain gated by existing flags and must never be treated as production wallet proof. It can prompt passkeys and write/clear diagnostic storage only after explicit diagnostic actions.

## Tests and limitations

`PistachioWalletController.test.jsx`, style tests, and service tests cover mocked state transitions. They do not prove physical passkey UX, browser portability, secure hardware, real wallet signatures, RPC, or transactions.
