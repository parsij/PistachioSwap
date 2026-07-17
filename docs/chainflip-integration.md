# Chainflip integration

## SDK and execution model

PistachioSwap uses `@chainflip/sdk/swap` on mainnet. Capability discovery calls the SDK chain and asset catalogs; quote discovery calls `getQuoteV2`; status uses `getStatusV2`. Only mainnet assets on chains with an EVM chain ID are normalized. Non-EVM Chainflip chains are intentionally outside this application's execution scope.

Chainflip is a `deposit-channel` route. `getQuoteV2` is read-only and stores a short-lived server-side quote reference. It does not allocate a deposit address. Only an explicit, owner-checked prepare request may call the SDK deposit-address operation. The general diagnostic never calls prepare and therefore can never allocate an address.

## Configuration and availability

Backend-only settings are `CHAINFLIP_ENABLED`, `CHAINFLIP_NETWORK=mainnet`, `CHAINFLIP_BROKER_API_URL`, and `CHAINFLIP_BROKER_COMMISSION_BPS`. Non-mainnet operation is rejected. An authenticated broker URL must be HTTPS and is redacted by diagnostics. Disabled configuration is SKIPPED. Enabled discovery without a broker is PARTIAL because capabilities and indicative quotes may work while execution is unavailable.

Chainflip coverage can be substantially smaller than the curated 25 EVM chains. It is limited to the SDK's current EVM-mainnet chain/asset intersection. Live verification is necessarily partial unless an operator supplies and validates broker configuration; documentation and deterministic tests do not claim a live executable route.

## Fees and ranking

SDK included fees are normalized as bridge/provider fees and marked included in the quote so ranking does not subtract them twice. Broker commission uses configured basis points. The common platform affiliate-fee mode is currently incompatible with Chainflip; a nonzero unsupported platform-fee configuration makes the adapter unavailable rather than silently dropping the fee. Ranking uses slippage-adjusted minimum egress and estimated duration.

## Deposit safety

Preparation binds the held quote to the original owner, source address, destination recipient, refund address, slippage, retry duration, and commission. The returned deposit record must be displayed with exact source asset, minimum amount, and expiry.

- Never send before preparation succeeds.
- Verify network, token, address, minimum/expected amount, and expiry together.
- Never reuse an address after expiry or for another asset/route.
- Do not treat creation of a deposit channel as source confirmation.
- Preserve only the public route ID for recovery; reload authoritative status from the API.

## Status and limitations

SDK states map from waiting and receiving through swapping/sending to completed or failed. Source receipt is not destination completion. Deposit and egress transaction references are exposed only as normalized status data.

Quotes are short-lived and server-memory quote references are not restart durable before preparation. Asset catalogs, minimum amounts, deposit-channel lifetime, broker availability, and supported EVM subsets can change. Vault swaps are not enabled. Operators should perform the manual small-value test before enabling production deposits.
