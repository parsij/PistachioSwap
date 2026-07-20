# Pistachio Wallet Controller Extraction

## Scope

The controller is located at `src/features/passkey/components/PistachioWalletController.jsx`; the existing feature path is preserved. The controller previously combined the modal shell, onboarding/setup screens, saved-wallet selection, unlocked wallet management, locked-session recovery, signing review, and wallet-manager coordination in 1,283 lines.

## Ownership Before and After

| Responsibility | Previous owner | Final owner | Risk |
| --- | --- | --- | --- |
| Manager snapshot subscription and modal lifecycle | controller | `PistachioWalletController.jsx` | High; preserves global manager bridge |
| Onboarding, creation, import, recovery phrase confirmation | controller | `PistachioWalletScreens.jsx` (`SetupContent` and setup screens) | High; secrets remain local to existing component state |
| Saved-wallet chooser, rename, export, local deletion | controller | `PistachioWalletScreens.jsx` | High; manager calls unchanged |
| Unlocked passkey and backup management | controller | `PistachioWalletScreens.jsx` (`UnlockedContent`) | High; timer and secret clearing unchanged |
| Locked-session blocking dialog and disconnect confirmation | controller | `PistachioWalletScreens.jsx` (`LockedSessionScreen`) | High; Radix focus and Escape behavior unchanged |
| Signing review queue | controller | `PistachioWalletScreens.jsx` (`SigningReviewDialog`) | High; approve/reject queue calls unchanged |
| Error copy, loading, shared wallet presentation | controller | `PistachioWalletScreens.jsx` | Medium; safe messages unchanged |

## State and Refs

The shell intentionally retains `snapshot`, `entryScreen`, `initialImportMode`, `sensitive`, `closeConfirmation`, `closeNotice`, `titleRef`, and `openerRef`, because they coordinate the outer modal and manager subscription. Screen-local state remains in the screen that owns it: setup secrets and confirmations, saved-wallet selection/rename/delete state, unlocked secret reveal state and timer, and locked-session unlock/disconnect guards.

## Security Boundary

No wallet cryptography, derivation, persistence format, passkey operation, signing operation, or `walletManager.js` code moved. Screen components continue to call the same singleton manager; sensitive values remain transient React state/refs and are not logged or newly persisted.

## Tests

`src/features/passkey/components/PistachioWalletController.test.jsx` covers the extracted screens through the controller, including setup, lock/unlock, backup/reveal, deletion, and signing review. These mocks do not prove real WebAuthn, encryption, secure storage, key derivation, or signing behavior.

## Safe Move Order

1. Move shared presentation and screen implementations without changing JSX or CSS classes.
2. Export only screens consumed by the shell.
3. Keep manager initialization, activity tracking, portal lifecycle, and receipt/signing entry points in the controller.
4. Run focused controller tests, lint, build, and `git diff --check`.

## Final Screen Map

| Screen | Final path | Sensitive values | Manager boundary |
| --- | --- | --- | --- |
| Shared error/loading/security primitives | `src/features/passkey/components/wallet/WalletPrimitives.jsx` | None | None |
| Entry, import chooser, restore file | `src/features/passkey/components/wallet/WalletSetupScreen.jsx` | Imported file text is transient | `walletUIOperations` |
| Passkey setup, recovery phrase, import confirmation | `src/features/passkey/components/wallet/WalletOnboardingScreen.jsx` | Recovery phrase, private key, keystore password | `walletUIOperations` |
| Saved wallet list, rename, delete, selection | `src/features/passkey/components/wallet/SavedWalletScreen.jsx` | Delete confirmation text | `walletUIOperations` |
| Unlocked passkey and backup management | `src/features/passkey/components/wallet/UnlockedWalletScreen.jsx` | Revealed secret ref and backup passwords | `walletUIOperations` |
| Locked session and exit confirmation | `src/features/passkey/components/wallet/LockedWalletScreen.jsx` | Unlock prompt state only | `walletUIOperations` |
| Signing review | `src/features/passkey/components/wallet/WalletSigningReview.jsx` | Signing payload summary only | `walletUIOperations` |

`PistachioWalletScreens.jsx` is now an eight-line export composition module. The focused controller suite remains the regression boundary for all screens.
