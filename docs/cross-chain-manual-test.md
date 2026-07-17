# Cross-chain manual test

Use a staging API and disposable wallets. Start with provider sandbox/test facilities where available; this implementation otherwise permits mainnet only. Never paste private keys into environment files or logs. The diagnostic is read-only, but route preparation and wallet submission are not.

## 1. Preflight and finite diagnostics

1. Verify backend provider settings, treasury/fee mode, database, HTTPS hosts, and CORS. Confirm no provider secret uses a `VITE_*` name.
2. Run targeted verification tests and API typecheck.
3. Run `pnpm --dir apps/api debug:cross-chain-providers`.
4. Confirm exactly 25 matrix rows and only `SUPPORTED`, `PARTIAL`, `SKIPPED`, or `UNSUPPORTED` states.
5. Confirm disabled/missing-auth providers are not reported as fully supported, printed URLs contain no credentials/query secrets, and the process terminates.
6. Confirm the run created no server, signature request, transaction, route execution, or Chainflip deposit address.

Record timestamp, environment, commit, configuration switches (never values), matrix, and quote summaries. Capabilities are dynamic; do not convert this output into a permanent support promise.

## 2. Metadata and UI

1. Inspect all 25 chain names, IDs, and native symbols in both source and destination selectors.
2. Verify Send works as a candidate action on every chain; verify same-chain swap, gasless, and MegaFuel remain BNB Smart Chain-only.
3. Select different source/destination chains. Same-chain cross-chain requests must be rejected.
4. Verify no excluded-provider label or fallback appears in cards, errors, network traffic, configuration, or bundled frontend.
5. Reload after changing backend enablement and after capability TTL expiry; disabled providers must disappear or return unavailable without stale executable data.

## 3. Quote and ranking

For one currently supported pair per enabled provider:

1. Request an exact-input quote with known token decimals and a small amount.
2. Verify owner, recipient, chain IDs, token addresses, input amount, slippage, minimum output, expiry, fee currencies, and duration.
3. Confirm unsupported chain/token pairs return no route and are not generalized from chain-only branding.
4. Compare Best return, Fastest, and Lowest fees. Unknown fees must not display as zero/free. The backend recommendation must use fee-adjusted minimum output, with duration only as a tie-break.
5. Tamper with recipient, amount, source chain, transaction target, allowance target, calldata shape, and extra request fields. Every mismatch must fail closed.

## 4. EVM transaction providers

Test Across, deBridge DLN, and Relay separately with the smallest practical value:

1. Prepare the selected public route using the same owner.
2. Check every returned step is on the expected chain and in provider order; Relay approval must precede its source action.
3. Claim source submission once. A second claim or a different replacement hash must be rejected.
4. Review the wallet transaction, sign locally, broadcast once, and report the source hash.
5. Observe source-confirming, in-flight, destination-confirming, and terminal state. Source confirmation alone must never show completed.
6. Reload during each nonterminal state. Only the public route ID should be recovered; status must resume from the API.
7. Verify failed, expired, and refunded provider responses map to the corresponding public state and provide no stale executable transaction.

## 5. Chainflip deposit safety

Chainflip coverage can be smaller than 25 chains and live verification is partial until a broker-backed route passes this section.

1. Keep Chainflip disabled unless mainnet broker configuration has been approved.
2. Quote first and verify no deposit address appears.
3. Prepare once with the same owner. Confirm this is the first point at which an address is allocated.
4. Before sending, compare source network, exact asset, address, required amount, refund/recipient, and expiry with the prepared route. Abort on any mismatch or expiry.
5. Send only the controlled minimum value. Never reuse the address or send a different asset.
6. Verify waiting/receiving/swapping/sending progress and destination completion. Reload by public route ID.
7. Test an expired quote without depositing; preparation must fail or yield a new independently reviewed route.

## 6. Fees, disable/re-enable, and evidence

1. With platform fees disabled, verify no platform fee is claimed.
2. With an approved treasury and fee rate, verify Across, deBridge, and Relay send their documented affiliate fields and normalized output contains one platform fee.
3. Verify incompatible Chainflip platform-fee configuration makes it unavailable.
4. Disable each provider, restart/reload configuration, and confirm SKIPPED/unavailable behavior. Re-enable only after capabilities reload.
5. Capture redacted API responses, public route IDs, transaction hashes, final balances, fee calculations, timings, and terminal statuses. Never capture API keys, authorization headers, authenticated broker URLs, signatures, private keys, or full sensitive environment output.
