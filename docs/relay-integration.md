# Relay integration

## API and execution model

The adapter uses the official Relay API base `https://api.relay.link`:

- `GET /chains` for dynamic chain contract metadata
- `POST /quote/v2` for an `EXACT_INPUT` route and ordered execution steps
- `GET /intents/status/v3?requestId=…` for intent tracking

Relay is an `evm-transaction` provider. A quote can contain multiple ordered items, including approvals. PistachioSwap preserves provider order, validates every item's chain and target against that chain's discovered contracts, and exposes no executable step if metadata is missing.

## Configuration and authentication

Backend-only settings are `RELAY_ENABLED`, `RELAY_API_BASE_URL`, and `RELAY_API_KEY`. The configured base must use the official HTTPS host. The key is sent only as a backend `x-api-key` header. The diagnostic labels missing optional authentication PARTIAL, disabled configuration SKIPPED, and absent exact routes UNSUPPORTED; it never prints the key or authenticated URL.

## Fees, ranking, and status

When configured, platform fees use Relay `appFees` with treasury recipient and basis-point fee. App fees are removed from generic provider-fee parsing and added once as a normalized platform fee. Relay gas and relayer fees retain their token when a valid currency address is supplied. Common ranking compares fee-adjusted minimum output and then time.

The request ID from the actionable step is used for status. Pending/depositing, in-flight/delayed, destination-submitted, completed, failed, and refunded provider states map to conservative public states. Reload resumes from the persisted public route ID, not from raw Relay data.

## Validation and limitations

User, recipient, exact chain pair, currencies, amount, slippage basis points, and exact-input trade type are fixed by the normalized request. Every returned transaction requires valid hex calldata, integer value, curated chain ID, and a target from per-chain metadata. Unknown fee shapes remain unknown rather than being treated as zero.

Relay's chain catalog is not token-pair availability. Quotes may still be unavailable because of liquidity, amount, solver, authentication tier, app-fee support, or temporary service state. Capabilities must be reloaded and exact quotes retried; static all-to-all token support must not be claimed.
