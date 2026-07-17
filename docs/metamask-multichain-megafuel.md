# MetaMask Connect Multichain MegaFuel Experiment

## Purpose and status

This experiment adds MetaMask Connect Multichain as an auxiliary raw-transaction signing transport for BNB Chain. Reown AppKit and Wagmi remain authoritative for the connected wallet, account, balances, token selection, quotes, authentication, normal swaps, and 0x Gasless typed-data signing.

The experiment is unverified until a real MetaMask session proves that `eth_signTransaction` returns a complete legacy serialized transaction without changing `gasPrice: 0x0` or any other backend-prepared field.

Calling `window.ethereum.request({ method: 'wallet_createSession' })` was previously tested and returned JSON-RPC `-32601`. The regular injected EIP-1193 provider does not expose the Multichain session API. This implementation therefore uses only the official `@metamask/connect-multichain` client and never substitutes `window.ethereum`.

## Session and account model

The requested BNB Chain scope is `eip155:56`. A session is usable only when:

- the normal AppKit wallet is connected and identified as MetaMask using connector RDNS, a known connector ID, or verified WalletConnect peer metadata;
- `session.sessionScopes['eip155:56']` exists;
- the scope contains a valid CAIP-10 account such as `eip155:56:0x...`;
- that account matches the AppKit address and backend-authenticated wallet address case-insensitively; and
- the approved method list explicitly contains `eth_signTransaction`.

The SDK session listener is registered once before a connection request. Initialization calls `client.provider.getSession()` to restore an existing persisted SDK session, but it never calls `connect()` automatically when no session exists. A new connection or forced permission refresh requires a visible user action. Account, scope, or session changes immediately invalidate in-memory verification.

Method support is not assumed from MetaMask documentation or product identity. An advertised method produces `ready-unverified`; only an actual raw signature that passes every local check produces `verified` for the current in-memory session/account fingerprint.

## Exact transaction boundary

The frontend signs only the authoritative transaction returned by the sponsorship intent preparation endpoint. The strict normalizer accepts exactly these fields:

```text
type, chainId, from, to, nonce, gas, gasPrice, value, data
```

The normalized request is BNB Chain legacy type 0 with `chainId: 0x38` and `gasPrice: 0x0`. It rejects extra fields, EIP-1559 fields, a wrong account or chain, a nonzero gas price, malformed quantities, an invalid destination, or malformed calldata. The frontend does not calculate recipients, amounts, spenders, calldata, nonce, or gas limit.

The signing request is:

```js
await client.invokeMethod({
  scope: 'eip155:56',
  request: {
    method: 'eth_signTransaction',
    params: [normalizedTransaction],
  },
})
```

There is no `eth_sendTransaction`, `personal_sign`, `eth_sign`, typed-data, or injected-provider fallback. Version `1.2.0` types `invokeMethod` as generic JSON and documents no raw-transaction wrapper. The implementation therefore accepts only a direct complete `0x...` serialized result. Partial `r`/`s`/`v` data is insufficient for the current MegaFuel flow.

Viem parses the returned transaction and recovers its signer. Before submission, the frontend checks the signer against both AppKit and the CAIP account, chain 56, legacy type, exact nonce, exact destination, byte-for-byte calldata, exact native value, exact gas limit, zero gas price, absent EIP-1559 fee fields, and no access list. Any mismatch fails closed. The raw bytes remain in local function variables and move directly into the existing sponsorship submission request.

The backend remains authoritative and repeats signer, chain, type, nonce, destination, calldata/hash, value, exact gas limit, zero gas price, fee-field, access-list, intent-expiry, one-attempt, business-action, and MegaFuel sponsorability checks before forwarding.

## Configuration

All flags default to disabled:

```dotenv
VITE_METAMASK_MULTICHAIN_ENABLED=false
VITE_BSC_PUBLIC_RPC_URL=
```

`VITE_BSC_PUBLIC_RPC_URL` is public browser configuration. It must be HTTPS, except HTTP localhost during development. Credential-bearing URLs and NodeReal URLs are rejected. Never put a NodeReal key, private RPC endpoint, or MegaFuel policy UUID in Vite configuration.

## Manual test procedure

1. Set a non-secret public BSC HTTPS RPC and manually enable the Multichain feature.
2. Start the frontend and backend manually.
3. Connect MetaMask through the normal PistachioSwap AppKit flow.
4. Ensure BNB Chain and the intended address are selected.
5. Open the Gas Assist prepayment flow and click **Enable MetaMask sponsored signing** / **Connect MetaMask signing**.
6. Approve the MetaMask Multichain BSC session.
7. Confirm the UI detects the BSC scope, an account matching AppKit, and approved `eth_signTransaction`.
8. Review the prepared MegaFuel transaction and confirm that it is a legacy BNB Chain transaction with gas price 0.
9. Confirm MetaMask displays a signature request, not a browser broadcast request, then approve it.
10. Confirm the existing backend submission flow accepts the exact signed transaction without any frontend field rewrite.
11. Treat method unavailable, a missing raw transaction, a signer mismatch, or any rewritten field as unsupported. A nonzero gas price must keep the transport disabled.
12. Do not enable production MegaFuel signing until this test succeeds on supported production MetaMask versions and platforms.

The expected successful result is a complete serialized legacy transaction whose recovered signer and every prepared field match exactly. The unsupported result is a missing method, missing complete raw transaction, altered signer/chain/type/nonce/destination/calldata/value/gas limit, nonzero gas price, EIP-1559 fields, or an access list.

## Prior wallet comparisons

- Bitget raw signing returned a serialized transaction, but the wallet rewrote the gas price. That is incompatible with MegaFuel zero-gas sponsorship.
- SafePal returned `-32601` for `eth_signTransaction`.
- MetaMask's regular injected provider returned `-32601` for `wallet_createSession`; this is why the official Multichain client is required.

## Security and rollout limitations

This code proves only deterministic implementation behavior. It does not prove that a specific MetaMask extension/mobile release authorizes `eth_signTransaction`, returns complete raw bytes, preserves zero gas, or presents an acceptable signing prompt.

Production rollout requires manual compatibility results across supported MetaMask versions and transports, successful zero-gas diagnostics, review of wallet prompt semantics, monitoring that never captures raw bytes, backend validation remaining enabled, strict public-RPC configuration, a rollback flag, and an explicit allowlist of tested client versions. `eth_sendTransaction` must remain forbidden because it combines signing and broadcasting outside the backend-controlled MegaFuel submission flow.
