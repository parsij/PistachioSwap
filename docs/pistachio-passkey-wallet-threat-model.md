# Pistachio Wallet threat model

**Security status: unaudited.** This design reduces password-storage and main-thread key exposure; it does not make a browser hot wallet equivalent to a hardware wallet.

## Protected assets

- BIP-39 entropy or the imported 32-byte EVM private key.
- WebAuthn PRF output, the derived KEK, and the random DEK.
- Unsigned intent integrity and exact signed transactions.
- Recovery disclosures and encrypted backup portability.

## Trust boundaries

The authenticator owns the WebAuthn credential private key and evaluates PRF. Browser WebAuthn returns PRF output only after user verification. The wallet worker owns PRF processing, KEK derivation, DEK unwrap, payload decryption, the ethers wallet, and signing. IndexedDB owns only ciphertext and public metadata. AppKit owns connected-account state. The backend remains authoritative for MegaFuel preparation, validation, billing, and submission.

## Primary controls

- Independent EVM key material; no EVM derivation from passkey data.
- WebAuthn resident credential, user verification, exact credential allow-list, and verified 32-byte PRF result.
- HKDF-SHA-256 domain separation by protocol version, vault ID, and RP ID.
- AES-256-GCM with unique random payload and wrapping IVs and canonical authenticated metadata.
- Strict schema validation and future-version rejection before decrypt.
- Bundled worker isolation, narrow message operations, request IDs, and termination on lock.
- One expiring signing review at a time, duplicate rejection, signer recovery, and exact transaction comparison.
- BNB Chain-only chain invariants and exact zero-gas legacy MegaFuel validation.
- No secret persistence in Web Storage, cookies, URLs, app state persistence, service-worker caches, or backend requests.

## In-scope attacks and residual risk

**XSS or compromised first-party script:** can observe secret-entry UI, request reauthentication, manipulate review text, or invoke worker APIs while the wallet is unlocked. CSP, dependency control, review UI, short unlock windows, and worker isolation reduce but do not eliminate this risk.

**Malicious browser extension:** may read or modify the page and capture recovery words or private-key disclosures. Passkeys do not protect a compromised browser session.

**Supply-chain compromise:** a compromised dependency or build step can alter wallet behavior. Lockfiles, dependency review, reproducible builds, CSP, and independent audits are required.

**Compromised device or browser profile:** may expose IndexedDB ciphertext, intercept user input, or abuse an unlocked worker. Device security remains mandatory.

**IndexedDB theft/tampering:** ciphertext theft supports offline attack against authenticator-derived protection; metadata changes covered by AAD fail decryption. Unknown schemas and corrupted records fail closed. Public labels and timestamps are not secrets.

**Passkey deletion or credential-manager incompatibility:** can make a vault wrap unusable. A second passkey and tested offline wallet recovery are required mitigations. Browser credential deletion is outside PistachioSwap control.

**RP-ID change:** makes credentials unavailable by WebAuthn design. Localhost, staging, and production are intentionally isolated.

**Synced-passkey assumptions:** PRF availability and output stability are not guaranteed across authenticator implementations or credential managers. IndexedDB never syncs with the credential.

**Memory extraction:** worker isolation is not a secure enclave. JavaScript strings, ethers objects, garbage-collected copies, crash dumps, and compromised browser internals cannot be reliably zeroized.

**Phishing and approval confusion:** explicit origin, full message/typed data, destination, calldata, fees, and MegaFuel submission disclosure reduce risk. Users can still approve a malicious request.

**RPC or backend compromise:** normal RPC can censor or reject transactions but cannot change a transaction after exact local signing. A malicious backend could prepare a harmful transaction; explicit review and exact comparison preserve what was approved but do not establish business intent. MegaFuel backend validation remains mandatory.

## Explicitly not provided

- Hardware-backed EVM signing or hardware-wallet equivalence.
- Server custody, key escrow, password reset, social recovery, MPC, or account abstraction.
- Cross-device wallet sync or guaranteed synced-passkey portability.
- Protection from a fully compromised device, browser, origin, dependency graph, or user-approved malicious transaction.
- Audit, production readiness, or assurance for meaningful funds.

## Required audit scope

An independent review must cover WebAuthn option construction and RP-ID deployment, PRF capability behavior across real authenticators, HKDF/AES-GCM use and AAD coverage, IndexedDB transactions, worker bundling and message validation, recovery disclosure, connector/AppKit lifecycle, 0x typed-data behavior, MegaFuel exact signing and duplicate submission, normal RPC broadcast, CSP/header deployment, dependency provenance, and UI redressing/phishing resistance.
