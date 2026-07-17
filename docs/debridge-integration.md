# deBridge DLN integration

## API and execution model

The adapter uses the official DLN API base `https://dln.debridge.finance`:

- `GET /v1.0/supported-chains-info` for provider/internal chain IDs and contract metadata
- `GET /v1.0/dln/order/create-tx` to estimate and create an exact-input source transaction
- `GET /v1.0/dln/order/{orderId}/status` for order tracking

DLN is normalized as an `evm-transaction` route. Provider chain IDs are never assumed to equal EVM chain IDs. Only explicitly verified source deployments or a valid source contract supplied by capability metadata can create routes. Unknown deployments remain UNSUPPORTED.

## Configuration and authentication

Backend-only settings are `DEBRIDGE_ENABLED`, `DEBRIDGE_API_BASE_URL`, `DEBRIDGE_ACCESS_TOKEN`, and `DEBRIDGE_REFERRAL_CODE`. Only the official HTTPS host is accepted. The diagnostic reports unauthenticated public checks as PARTIAL and disabled configuration as SKIPPED. Tokens and authenticated URLs are redacted and never copied to frontend variables.

## Fees, ranking, and status

The create transaction requests operating expenses to be prepended. A configured platform fee uses `affiliateFeePercent` and `affiliateFeeRecipient`; the referral code is independent. Provider cost fields are normalized only when they contain valid integer amounts, and the platform fee is represented once. Ranking uses the fee-adjusted recommended minimum output, then duration.

Order status maps conservatively to in-flight, destination-confirming, completed, failed, refunded, or unknown. The public order tracking ID is held behind the route service so browser reloads resume by public route ID.

## Validation and limitations

The exact route must supply source/destination internal IDs. The returned source transaction must match the requested source EVM chain and a discovered DLN source target. Output and recommended minimum amounts are base-unit integers. If DLN's recommended slippage exceeds the user's limit, the quote fails closed.

Current deployment verification can be narrower than DLN's published chain catalog; this is intentional. Token liquidity, order size, affiliate eligibility, authentication, API changes, and destination support remain dynamic. Add a chain only after verifying its source deployment and fixtures—never by copying a chain ID into a generic map.
