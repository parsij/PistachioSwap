# Pistachio Wallet UI manual test

Use a disposable browser profile, fake wallet material, and a test-only wallet with no funds. Complete this checklist only after manually starting the frontend and backend. Do not record recovery words, private keys, keystore passwords, passkey identifiers, PRF output, or signed transactions in screenshots or test notes.

**Critical regression reminder:** Disconnecting must not delete a saved Pistachio Wallet.

## Common checks

Run every applicable route at `320 x 568`, `375 x 667`, `390 x 844`, `430 x 932`, `768 x 1024`, `827 x 1352`, `1280 x 720`, and `1440 x 900`.

- Desktop: the dialog is centered, its header remains visible, and tall content scrolls inside the dialog.
- Mobile: the bottom sheet fits the width, respects safe areas, and has no horizontal overflow or clipped action.
- Keyboard: focus begins inside the dialog, Tab and Shift+Tab stay inside it, focus rings are visible, and focus returns to the opener after close.
- Layering: Reown AppKit closes before Pistachio Wallet opens; no AppKit connection card remains above or behind it.
- Failure: errors contain no stack trace, cryptographic details, provider payload, or secret fragment and always leave a retry, back, restore, or close path.
- Storage: inspect IndexedDB only for public metadata and encrypted fields. Never capture or paste the record into test reports.
- Motion: with reduced motion enabled, the dialog remains usable without entrance transitions.

## 1. AppKit connector entry

- Starting state: disconnected; no Pistachio modal open.
- Steps: open AppKit and select **Create or Import Pistachio Wallet**.
- Expected screen/buttons: AppKit closes first; one **Pistachio Wallet** dialog opens with the correct no-vault or previous-wallet screen.
- Close/back: close rejects the connector request once and removes all AppKit loading or “Continue in wallet” UI.
- Connector: no message signing, account connection, or authentication begins before onboarding or unlock completes.
- Stored data: unchanged until a save or restore action succeeds.
- Desktop/mobile/keyboard: run the common checks, including focus returning to the AppKit opener when it still exists.
- Failure: reopen the connector and confirm a clean screen with no stale spinner or old sub-route.

## 2. Direct and header entry

- Starting state: any swap quote, Gas Assist, and sponsorship state.
- Steps: use the header Pistachio icon, then run `window.openPistachioWallet()` and `window.closePistachioWallet()` in development.
- Expected screen/buttons: the same first-party wallet flow opens independently of swap state.
- Close/back: close returns to the underlying application without changing the quote.
- Connector: direct opening does not create a connector request or sign anything.
- Stored data: unchanged.
- Desktop/mobile/keyboard/failure: run the common checks and verify repeated open commands never create duplicate dialogs.

## 3. First-time wallet creation

- Starting state: no saved vault; import and passkey flags enabled.
- Steps: **Create a new wallet** -> review risk -> **Create passkey and continue** -> complete test passkey -> **Generate recovery phrase** -> record fake words -> confirm requested positions -> **Confirm and save wallet**.
- Expected screen/buttons: creation is marked **Recommended**; wallet words do not exist before passkey verification; the save button stays disabled until all requested words match; no Skip action exists.
- Close/back: Back works before passkey creation. Close after passkey creation or phrase display requires confirmation. Close is blocked during browser prompt and encrypted persistence.
- Connector: resolves only after **Connect wallet**; standalone entry offers **Done**.
- Stored data: one new encrypted vault is added only after persistence read-back and address verification.
- Desktop/mobile: verify word numbers, two-column narrow layout, copy button, confirmation fields, and internal scrolling.
- Keyboard: enter all confirmation fields and activate save without a pointer.
- Failure: cancel the passkey, retry, then simulate storage failure and confirm **Try again** remains available.

## 4. Recovery phrase import

- Starting state: no vault or **Create or import another wallet**.
- Steps: **Import an existing wallet** -> **Recovery phrase** -> acknowledge risk -> create passkey -> enter fake 12, 15, 18, 21, and 24-word fixtures separately -> review address -> confirm -> save.
- Expected screen/buttons: explicit unsupported BIP-39 passphrase notice, **Review imported wallet**, address preview, and **Encrypt and save wallet**.
- Close/back: Back is available before passkey creation; guarded close applies afterward.
- Connector: resolves only after the saved wallet is explicitly connected.
- Stored data: imported entropy is encrypted; existing vaults remain present.
- Desktop/mobile/keyboard: verify textarea, labels, address wrapping, and virtual-keyboard scrolling.
- Failure: invalid word and invalid checksum errors are readable, contain no phrase fragment, clear the input, and allow another attempt.

## 5. Private-key import

- Starting state: no vault or another-wallet menu.
- Steps: choose **Private key**, acknowledge risk, create passkey, enter fake valid fixtures with and without `0x`, acknowledge independent backup, review address, and save.
- Expected screen/buttons: clear “no recovery phrase” warning, exact 64-hex guidance, backup acknowledgement, address preview.
- Close/back/connector: same guarded setup and explicit connection behavior as recovery import.
- Stored data: only the encrypted normalized key is persisted; existing vaults remain present.
- Desktop/mobile/keyboard: verify secret textarea and address wrap without horizontal scrolling.
- Failure: test short, non-hex, and invalid-scalar fixtures. The error must not repeat input and the field must clear.

## 6. Keystore import

- Starting state: keystore import flag enabled.
- Steps: choose **Keystore file**, acknowledge risk, create passkey, click the dropzone and repeat by drag-and-drop, enter the separate fake password, acknowledge backup, review, and save.
- Expected screen/buttons: selected filename, labelled password field, password-not-stored explanation, **Unlock keystore and review**.
- Close/back/connector: same guarded setup and explicit connection behavior as other imports.
- Stored data: uploaded JSON and password are cleared; the uploaded file is not stored as the active record.
- Desktop/mobile/keyboard: verify the file chooser opens from keyboard, filename wraps, and the virtual keyboard does not cover the action.
- Failure: test oversized, malformed, unrelated, non-V3, and wrong-password fixtures. Each result is safe and retryable.

## 7. Encrypted backup restore

- Starting state: entry or another-wallet menu with a fake exported Pistachio backup.
- Steps: click or drop the backup, then use its matching test passkey.
- Expected screen/buttons: cross-device and RP-ID limitation copy remains visible; the matching wallet unlocks and returns to the main app.
- Close/back: Back returns to the prior menu before file selection; close during the passkey prompt is blocked.
- Connector: resolves only after successful backup unlock.
- Stored data: a valid non-duplicate encrypted vault is added; invalid files add nothing.
- Desktop/mobile/keyboard: verify the dropzone and long filename fit.
- Failure: test invalid JSON, schema mismatch, corrupted ciphertext, duplicate vault, RP-ID mismatch, and unavailable passkey.

## 8. Previous wallet and unlock

- Starting state: exactly one saved encrypted wallet and a locked connector.
- Steps: open Pistachio Wallet and select **Use previous wallet**.
- Expected screen/buttons: **Previous Pistachio Wallet detected**, shortened address, name, source, last-used date, **Use previous wallet**, and **Create or import another wallet**. No saved-wallet chooser appears for one vault.
- Close/back: passkey begins only after the unlock button; cancel returns to a usable recovery screen.
- Connector: successful unlock resolves with the same address; repeated clicks produce one browser prompt.
- Stored data: unchanged except safe last-used metadata.
- Desktop/mobile/keyboard/failure: run common checks; cancel and retry the passkey.

## 9. Missing passkey

- Starting state: a saved fake vault whose test credential is unavailable.
- Steps: attempt unlock.
- Expected screen/buttons: exact message **This wallet is saved in this browser, but its passkey is unavailable.** plus **Try again**, **Restore using recovery phrase**, **Restore encrypted backup**, **Import private key**, and secondary **Remove inaccessible wallet from this browser**.
- Close/back: recovery routes remain available; removal has its own guarded confirmation.
- Connector: stays pending during retry or recovery and rejects cleanly on close.
- Stored data: unchanged until an explicit successful restore or removal.
- Desktop/mobile/keyboard/failure: verify no destructive action receives primary styling.

## 10. Multiple saved wallets

- Starting state: two or more fake encrypted vaults.
- Steps: **Choose another saved wallet** -> unlock, rename, export, and switch each entry.
- Expected screen/buttons: **Saved Pistachio Wallets**, selected marker, shortened address, source type, last-used date, **Unlock**, **Rename**, **Export encrypted backup**, and **Remove from this browser**.
- Close/back: Back returns to previous-wallet detection.
- Connector: switching locks and terminates the current worker before requesting the selected wallet’s passkey.
- Stored data: rename changes only safe preference metadata; creating another wallet preserves all existing vaults.
- Desktop/mobile: test long names, similar addresses, list scrolling, and single-column mobile actions.
- Keyboard/failure: rename and cancel by keyboard; unavailable selected passkey exposes recovery without affecting other entries.

## 11. Disconnect, reconnect, and lock

- Starting state: unlocked Pistachio connector with at least one saved vault.
- Steps: **Disconnect**, reconnect through AppKit, then test **Lock wallet**, 15-minute inactivity lock, refresh reconnect, and a second-tab unlock.
- Expected screen/buttons: disconnect returns AppKit to disconnected state; reconnect shows previous-wallet detection and requires a passkey.
- Close/back: closing reconnect rejects cleanly.
- Connector: worker terminates and pending reviews reject on every lock path; no stale connected badge remains.
- Stored data: every encrypted vault, passkey wrap, address, name, and metadata remains after Disconnect and Lock.
- Desktop/mobile/keyboard/failure: confirm the same address reconnects and cross-tab lock never transfers a secret.

## 12. Backup, passkeys, and secret reveal

- Starting state: unlocked saved wallet opened from the header icon.
- Steps: rename passkey, test unlock, add backup passkey, acknowledge offline recovery, export backup, reveal the fake phrase or key, and hide it.
- Expected screen/buttons: **Add backup passkey**, **Test passkey unlock**, **Export encrypted backup**, **Reveal recovery phrase** or **Reveal private key**, **Hide**, and **Lock wallet**.
- Close/back: active passkey requests and visible secrets use guarded close; reveal hides after 60 seconds.
- Connector: remains connected unless explicitly locked or disconnected.
- Stored data: new wraps are encrypted; final wrap cannot be removed; reveal material is never persisted or automatically copied.
- Desktop/mobile/keyboard/failure: test long passkey labels, disabled final-wrap removal, and failed reauthentication.

## 13. Remove from this browser

- Starting state: saved wallet chooser or missing-passkey recovery.
- Steps: **Remove from this browser** -> review full address -> acknowledge backup -> type exact `DELETE` -> final remove.
- Expected screen/buttons: exact title **Remove wallet from this browser**, local-only warning, full address, acknowledgement, typed confirmation, **Cancel**, and **Remove from this browser**.
- Close/back: Escape or overlay cannot bypass the confirmation; Cancel changes nothing.
- Connector: removing the active local copy locks and disconnects it.
- Stored data: only the selected encrypted vault is removed; other vaults and funds remain unaffected.
- Desktop/mobile/keyboard/failure: test `delete`, whitespace, unchecked backup, and a storage failure before exact confirmation.

## 14. Signing review

- Starting state: unlocked fake wallet with a deterministic mocked request.
- Steps: review and reject, then review and approve fake message, typed-data, transfer, approval, normal swap, 0x Gasless, and MegaFuel requests.
- Expected screen/buttons: action, wallet, BNB Chain, origin, relevant destination/token/amount/spender/provider/fees, complete message or fields, expiry, **Reject**, and **Approve**. Contract data remains visible with a warning. MegaFuel shows gas price `0` and that PistachioSwap submits the signed transaction.
- Close/back: overlay and Escape do not approve or dismiss; the explicit close icon rejects.
- Connector: one active request only; stale and duplicate actions reject.
- Stored data: no request, signature, or raw signed transaction is persisted or logged.
- Desktop/mobile/keyboard/failure: verify long calldata scrolls internally, unknown data is not hidden, Reject is first in focus order, and expiry returns control to the app.

## 15. Storage and worker failures

- Starting state: mocked IndexedDB unavailable, worker fatal error, or corrupted local record.
- Steps: open wallet, select **Try again**, then restore browser storage and repeat.
- Expected screen/buttons: **Encrypted storage unavailable**, safe explanation, and **Try again**.
- Close/back: close always rejects a pending connector and restores page scrolling/focus.
- Connector: no account is exposed and AppKit loading ends.
- Stored data: no partial plaintext or incomplete vault is created.
- Desktop/mobile/keyboard/failure: run common checks and confirm no dead or blank dialog state.

## Manual screenshot set

With the servers started manually, capture masked deterministic fixtures for: no-vault entry, previous-wallet entry, wallet chooser, fake recovery phrase, mnemonic import, private-key import, keystore import, missing-passkey recovery, removal confirmation, signing review, mobile no-vault entry, mobile recovery phrase, and narrow-height internal scrolling. Do not capture real wallet material or browser passkey prompts.
