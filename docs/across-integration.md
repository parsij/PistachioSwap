# Across integration

## API and execution model

The adapter uses the official Across Swap API base `https://app.across.to/api`:

- `GET /available-routes` for dynamic chain/token pairs and SpokePool/deposit contract metadata
- `GET /swap/approval` for an exact-input approval/transaction quote
- `GET /deposit/status?depositId=…` for tracking

Across returns an `evm-transaction` route. PistachioSwap does not infer a SpokePool address: the quote target and allowance target must be present in capability metadata for the exact source/destination route. The client signs and submits only the validated source-chain step.

## Configuration and authentication

Backend-only settings are `ACROSS_ENABLED`, `ACROSS_API_BASE_URL`, `ACROSS_API_KEY`, and optional two-byte `ACROSS_INTEGRATOR_ID`. The URL parser permits only the official HTTPS host. Missing optional authentication is reported as PARTIAL by the diagnostic; a disabled adapter is SKIPPED. No setting is exposed through `VITE_*`.

## Fees, ranking, and status

With a nonzero platform fee and treasury, the request sends Across `appFee` as a decimal ratio and `appFeeRecipient`. The normalized platform fee is not double-counted with provider fee fields. Provider gas/bridge amounts and minimum destination output feed the common fee-adjusted-output ranking.

Deposit/fill status is mapped to pending/in-flight, destination-confirming, completed, failed, or refunded without treating source confirmation as completion. A persisted public route ID supports reload and status resumption.

## Validation and limitations

The request uses `tradeType=minOutput` and must exactly retain chains, token addresses, amount, depositor, recipient, and slippage. Amounts are integer base units; transaction chain, calldata, value, targets, minimum output, and expiry are validated before publication.

Across coverage is dynamic and often token/pair-specific. A curated chain appearing in the application does not imply an Across route. Authentication tier, liquidity, amount bounds, temporary API availability, or missing verifiable contract metadata can produce PARTIAL, UNSUPPORTED, or no quote. Re-run capability discovery after cache expiry rather than hard-coding support.
