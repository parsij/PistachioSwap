# Cross-chain provider architecture

PistachioSwap keeps cross-chain routing on the API. The browser builds an exact-input intent, displays normalized public routes, and executes only server-validated steps. Provider credentials, authenticated URLs, capability metadata, raw provider responses, and private route state stay on the backend.

## Adapter and service boundaries

Each provider adapter implements capability discovery, quote normalization, and status lookup. Preparation is optional and is used only when an execution model needs a late-bound artifact. The registry runs adapters independently behind concurrency/circuit controls and a positive/negative capability cache. The route service owns public IDs, persistence, preparation, source-submission claiming, and resumable status.

The four cross-chain adapters are Across, deBridge DLN, Relay, and Chainflip. LI.FI is deliberately not used: there is no runtime adapter, dependency, endpoint, environment variable, provider registry entry, fallback, or UI label for it. Documentation may state that exclusion; deterministic guards intentionally scan runtime/config surfaces rather than explanatory docs.

## Dynamic capabilities and exact routes

The curated chain list is a product allowlist, not a promise that every provider supports every chain, pair, token, amount, or execution model. Adapters discover current provider metadata and normalize explicit source/destination routes, provider chain IDs, token restrictions when supplied, and allowed transaction targets. A quote is requested only when one discovered route exactly matches both chain IDs and any advertised token restrictions. No route is inferred from a provider brand or a broad “EVM supported” claim.

Capabilities are cached briefly and must be reloaded after expiry, provider errors, configuration changes, or an operator disable. An unavailable discovery result is negatively cached for less time than a successful result.

## Validation, fees, and ranking

Requests accept exact-input mode only, two different curated chains, positive integer base-unit amounts, valid EVM addresses, bounded slippage, and a closed set of fields. Returned quotes must reproduce the exact chain, asset, amount, owner, and recipient intent. EVM calldata is accepted only for the expected chain and a transaction/allowance target present in fresh capability metadata. Outputs, values, expiries, and status identifiers are strictly normalized.

Provider fees are normalized by category and token. Configured platform fees use each provider's documented affiliate mechanism; incompatible fee configuration makes that provider unavailable instead of silently omitting the fee. Ranking compares fee-adjusted minimum destination output first, then estimated duration. Unknown fees are not treated as free in UI sorting.

## Execution and deposit safety

`evm-transaction` routes expose only validated, ordered source-chain steps. A client claims submission once before broadcasting and then records the resulting source hash. The API does not sign or broadcast.

Chainflip uses a `deposit-channel` model. Quote discovery creates no deposit address. The address is requested only during explicit route preparation, after owner checks, and is returned with the exact source asset, minimum amount, and expiry. Users must verify all four fields and never reuse an expired address. The diagnostic script never prepares Chainflip routes.

## Status and reload behavior

Public route state progresses through quoted, prepared/awaiting source, source submitted/confirmed, in flight, destination confirming, and terminal completed, failed, refunded, or expired states. Provider status is mapped conservatively; a source confirmation is not completion. The browser persists only the public route ID in the URL/local storage, reloads the public record from the API, and resumes polling. It never persists provider credentials, raw calldata, or a deposit address as recovery state.

## Configuration and operations

Backend controls include:

- `CROSS_CHAIN_CAPABILITY_TTL_MS`, `CROSS_CHAIN_NEGATIVE_CAPABILITY_TTL_MS`, and `CROSS_CHAIN_QUOTE_TIMEOUT_MS`
- provider `*_ENABLED`, backend base URL, API key/token, integrator/referral, and broker settings
- `PLATFORM_FEE_BPS`, `TREASURY_ADDRESS`, `FEE_COLLECTION_MODE`, and `FEE_TOKEN_MODE`

Disable a provider with its backend `*_ENABLED=false` switch and restart/reload API configuration. To add one, implement the adapter interface, add a literal registry/type entry, allow only official HTTPS hosts in config, normalize capabilities and statuses, validate transaction targets, document fee/execution behavior, and extend fixtures, guard tests, coverage, and manual checks. Never add a browser secret or generic fallback.

Known limitations: capabilities can change between discovery and quote; token support may be narrower than chain support; provider outages and authentication tiers can reduce coverage; quote fee currencies are not always USD-comparable; and the application supports EVM source/destination handling only. Chainflip's EVM-only asset subset can be much smaller than the curated 25-chain set.
