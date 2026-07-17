# Pistachio Wallet real-passkey manual test

**Initial status:** `AUTOMATED-VERIFIED / REAL-PASSKEY-UNVERIFIED` only after the finite Chromium/CDP suite passes. Virtual authenticators do not prove compatibility with Chrome, Google Password Manager, platform biometrics, phones, or physical security keys.

Only a successful manual result reported by the wallet owner may change the status to `REAL-PASSKEY-VERIFIED`.

## Preconditions

1. Use a disposable browser profile and test-only environment with no meaningful funds.
2. Confirm the production/staging/localhost RP ID is the intended one.
3. Configure only a public BSC RPC URL. Do not expose NodeReal or backend credentials in Vite variables.
4. Enable the required flags in the local frontend environment:

   ```dotenv
   VITE_PISTACHIO_LOCAL_WALLET_ENABLED=true
   VITE_PISTACHIO_PASSKEY_WALLET_ENABLED=true
   VITE_PISTACHIO_PASSKEY_DIAGNOSTICS=true
   ```

5. Restart Vite manually. Vite reads feature flags at startup.

## Diagnostic procedure

1. Open **Passkey Vault Test** independently of swap state.
2. Select **Detect WebAuthn support**.
3. Select **Detect client capability hints**. Treat any PRF hint as advisory.
4. Select **Create test passkey** and choose Chrome/Google Password Manager or the intended platform, phone, or security-key authenticator.
5. Approve fingerprint, face, device PIN, phone, or security-key verification.
6. Confirm registration reports PRF enabled and the exact credential assertion returns a 32-byte PRF result.
7. Select **Encrypt fake test payload**.
8. Select **Lock test vault**.
9. Select **Unlock with passkey**, use the same credential, and confirm the exact fake payload round trip passes.
10. Reload the page and unlock the persisted diagnostic record again.
11. Where portability matters, export and test an encrypted diagnostic or wallet backup on the target browser/device. Confirm the same credential is available, PRF is supported, output is compatible, and RP ID is unchanged.
12. Clear local diagnostic data. Then manually remove the test credential through the browser or password manager if no longer needed; clearing IndexedDB does not delete the passkey.

## Wallet procedure

1. Create a test-only 12-word wallet after passkey verification.
2. Record and confirm the requested random phrase positions without photographing, uploading, or sharing the phrase.
3. Confirm encrypted persistence and read-back verification succeed.
4. Finish and lock, then unlock again with the passkey.
5. Reload and unlock again.
6. Add a second passkey, test both wraps independently, and verify removal cannot delete the final wrap.
7. Export the encrypted Pistachio vault and test its restore assumptions in a disposable profile.
8. Test recovery from the phrase without using the browser vault.
9. For private-key wallets, test an encrypted V3 keystore backup before relying on it.
10. Review a fake message, typed-data request, normal transaction, and zero-gas MegaFuel fixture. Reject stale and duplicate reviews.
11. Do not broadcast during security validation. Use meaningful funds only after the full real-browser workflow and independent audit pass.

## Record the result

Record browser version, OS, authenticator/credential manager, RP ID, passkey transport, PRF registration result, repeated assertion result, reload result, second-passkey result, backup result, and any failure code. Do not record credential IDs, PRF output, wallet secrets, recovery words, private keys, keystore passwords, or raw signed transactions.

Pass criteria are exact decrypt round trip after reload, explicit passkey verification on every unlock, no plaintext vault secret in browser storage, and successful tested recovery independent of the passkey. A missing PRF result, incompatible synced credential, RP-ID mismatch, or unavailable credential is a failure, not a reason to add a password fallback.
