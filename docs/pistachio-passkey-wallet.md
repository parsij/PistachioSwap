# Pistachio Wallet

**Wallet class:** self-custodial browser hot wallet  
**Security status:** unaudited  
**Browser test status:** automated verification does not establish real-authenticator compatibility

Pistachio Wallet is a BNB Smart Chain-only wallet for chain ID `56` (`0x38`, `eip155:56`). It manages one account per encrypted vault and uses derivation path `m/44'/60'/0'/0/0` for BIP-39 wallets.

## Security architecture

The WebAuthn credential is not an Ethereum key. Pistachio Wallet generates or imports an independent secp256k1 wallet secret inside a bundled module worker. A random 256-bit data-encryption key (DEK) encrypts the wallet payload with AES-256-GCM. WebAuthn PRF output is input key material for HKDF-SHA-256, which derives a non-extractable AES-256-GCM key-encryption key (KEK). The KEK wraps the DEK.

The browser stores only ciphertext and public metadata in IndexedDB database `pistachio-wallet`, object stores `vaults` and `preferences`. It does not store mnemonic words, entropy, private keys, PRF output, DEKs, KEKs, passwords, assertions, or signed raw transactions. Versioned canonical additional authenticated data binds the vault and key wrap to the vault ID, wallet address, chain ID, RP ID, credential ID, source type, and derivation path.

PRF output moves to the worker using a transferable `ArrayBuffer`. The main-thread buffer must be detached. Unlock, private-key reconstruction, signing, DEK unwrap, and payload decrypt happen inside the worker. Lock rejects pending signatures, clears mutable byte arrays where practical, and terminates the worker. JavaScript strings and engine-managed objects cannot be reliably zeroized.

## Feature flags

All flags default to disabled:

```dotenv
VITE_PISTACHIO_LOCAL_WALLET_ENABLED=false
VITE_PISTACHIO_PASSKEY_WALLET_ENABLED=false
VITE_PISTACHIO_WALLET_IMPORT_ENABLED=false
VITE_PISTACHIO_WALLET_KEYSTORE_IMPORT_ENABLED=false
VITE_PISTACHIO_PASSKEY_DIAGNOSTICS=false
VITE_PISTACHIO_WALLET_AUTO_LOCK_MINUTES=15
VITE_PISTACHIO_PASSKEY_STAGING_RP_ID=
```

The passkey wallet requires both local-wallet and passkey-wallet flags. Mnemonic/private-key import has a separate flag; V3 keystore import has another. Diagnostics require Vite development mode and the diagnostic flag. Restart Vite after changing any flag. Never put wallet secrets, passkey output, backend keys, or private RPC credentials in `VITE_*` variables.

## Passkey registration and unlock

Registration requires a secure top-level context, resident credential, required user verification, and `prf.enabled === true`. Capability hints from `PublicKeyCredential.getClientCapabilities()` are advisory only. When registration does not return a PRF result, setup performs one immediate assertion for the exact credential and PRF input. It requires a 32-byte result and stops before wallet secret generation if PRF is unavailable.

Unlock reads the credential ID and PRF input from public vault metadata, requests the exact credential with required user verification and `evalByCredential`, checks a 32-byte result, and transfers it directly to a fresh worker. Assertion signatures, credential IDs, and passkey public keys are never used as encryption keys.

Each backup passkey has an independent credential, PRF input, HKDF salt, wrap IV, and wrapped copy of the same DEK. Adding one requires an unlocked wallet, reauthentication with an existing passkey, explicit creation, immediate PRF verification, and encrypted persistence read-back. The final wrap cannot be removed. Wrap removal requires an offline-recovery acknowledgement and does not delete the browser or password-manager credential.

## Wallet sources and recovery

Generated wallets use 128 bits of secure entropy for a 12-word English BIP-39 phrase. The encrypted payload contains entropy bytes, language, and derivation path, not plaintext words. Imported phrases must pass word and checksum validation; BIP-39 passphrases are unsupported. Private-key import accepts exactly 32 bytes and has no recovery phrase. Keystore import accepts Web3 Secret Storage V3 JSON up to 1 MiB and normalizes it to an encrypted private-key payload.

Recovery options are the BIP-39 phrase for mnemonic wallets, an encrypted keystore/private-key backup for private-key wallets, an exported encrypted Pistachio vault, and an optional second passkey. PistachioSwap has no password reset and cannot recover these secrets.

A synced passkey does not sync IndexedDB. An exported vault works elsewhere only if the same credential is available, the authenticator provides compatible PRF output, and the RP ID matches. This is not guaranteed across credential managers. Test every recovery path before relying on it.

## RP IDs and domains

Local development uses RP ID `localhost`. Production uses `pistachioswap.com`. An approved staging hostname is accepted only when its exact hostname is configured in `VITE_PISTACHIO_PASSKEY_STAGING_RP_ID`. Ports are never RP IDs.

Localhost, staging, and production credentials are separate. Changing the production domain can make existing credentials unavailable. Deleting a PRF-enabled passkey can make the encrypted browser vault unavailable even though the underlying wallet remains recoverable from its phrase or independent backup.

For deployment, `/.well-known/passkey-endpoints` may expose only a public `prfUsageDetails` URL such as `https://pistachioswap.com/docs/pistachio-passkey-wallet`. It must never return credential material, PRF output, wallet ciphertext, or wallet secrets.

## Integration and signing

The Wagmi connector ID is `pistachio-local`. It is registered through the existing Reown AppKit Wagmi adapter and never injects `window.ethereum`. AppKit remains authoritative. The connector returns no account while locked, never silently reauthorizes, supports only BNB Chain, and locks on disconnect or invariant failure.

Every message, typed-data, and transaction signature enters one 120-second review queue. MegaFuel raw signing accepts only the backend-prepared legacy transaction with chain ID 56, gas price zero, no EIP-1559 fields, and no access list. The signed transaction is parsed with Viem, the signer is recovered, and every prepared field is compared before the existing backend submission callback receives it. The browser does not broadcast MegaFuel transactions.

Existing 0x Gasless uses the same wallet client for authentication messages and server-provided typed data. Existing fee calculations and provider behavior are unchanged. Normal transactions are reviewed, signed locally, validated, and may be sent only to the configured public BSC RPC. NodeReal credentials are forbidden in browser configuration.

## Automatic lock

The default inactivity lock is fifteen minutes. The wallet also locks manually, on worker failure, cross-tab unlock, account mismatch, chain mismatch, and vault replacement. Page refresh or unload clears in-memory worker secrets but preserves the saved active session marker, so reconnect can restore the public account while requiring passkey unlock before signing. `BroadcastChannel` messages contain only vault IDs, tab IDs, and lock state. Unlocking a second tab locks the first.

## Deployment security headers

Production must use HTTPS and HSTS. The deployment layer should set:

```text
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; worker-src 'self'; script-src 'self'; connect-src 'self' https://<explicit-public-bsc-rpc> https://<explicit-reown-hosts> https://<explicit-api-host>; img-src 'self' data: https://<explicit-token-image-hosts>; style-src 'self' 'unsafe-inline'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

The exact Reown, RPC, API, and token-image origins must be inventoried from the production deployment before enforcing `connect-src` and `img-src`. This repository has no authoritative edge/proxy header configuration, so headers are documented rather than guessed. Third-party wallet connectivity remains present on wallet-secret screens; deployment header hardening is therefore **partial** until production origins and script behavior are validated.

Independent security review is required before meaningful funds or production claims.
