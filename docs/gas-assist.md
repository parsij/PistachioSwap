# Gas Assist

Gas Assist is the automatic zero-native-BNB execution path on BNB Chain. The
frontend waits for the connected wallet's raw native balance query to succeed.
When the balance is exactly `0n`, the sell asset is a non-native BEP-20, and the
public configuration enables `zero-x-gasless`, the active quote uses
`POST /v1/gas-assist/quote` instead of `POST /v1/quote`.

The selected output is preserved. It may be another BEP-20, WBNB, or native BNB
when 0x Gasless API v2 supports the pair. Gas Assist never changes the selected
output to BNB. The banner says “You have no native token to pay for gas, but
we’ve got you.” and explains that 0x Gasless includes network costs in the quote.

Normal funded-wallet swaps are unchanged: `POST /v1/quote` still compares 0x
Swap API, Uniswap, and PancakeSwap, and uses the normal configured fee (currently
`PLATFORM_FEE_BPS=45`). The user pays BNB gas on that path.

## Fees

Gas Assist uses a separate backend-only fee schedule:

```text
targetFeeUsd = min(5.00, sellValueUsd * 0.03 + 0.067)
dynamicFeeBps = floor(targetFeeUsd / sellValueUsd * 10000)
```

The backend uses integer-scaled USD and raw token arithmetic. It sends the
dynamic BPS, configured treasury, and selected sell token to 0x. It then checks
the returned integrator fee token and exact integer amount before persisting the
quote. The fee is never applied a second time or manually subtracted from the
buy amount. Whole BPS can collect slightly less than the mathematical target,
never more. Quote-time USD pricing is authoritative for the cap; settlement-time
USD value can move with the market.

The UI separately displays the PistachioSwap fee, 0x gas/network cost, 0x
protocol fee when present, expected output, and minimum output. Gas Assist is
not described as free.

## Approval and signing

- Existing allowance: sign only the 0x trade EIP-712 typed data.
- Gasless EIP-2612 approval: sign approval typed data, then trade typed data.
  Nothing is submitted until both signatures exist.
- On-chain approval required: fail with `ONCHAIN_APPROVAL_REQUIRED`. MegaFuel is
  not called and no approval transaction is sponsored.

If trade signing is rejected after approval signing, the local approval
signature is discarded and nothing is submitted. Unlimited permits are shown
as unlimited and may be rejected with
`GAS_ASSIST_REJECT_UNLIMITED_PERMITS=true`.

The browser submits only the internal quote ID and required signatures. The
backend reloads the authoritative quote, verifies EIP-712 signers, reserves the
quote atomically against replay, and submits the stored approval/trade objects.
Expired quotes cannot be signed or submitted; refreshed quotes require a new
explicit user action and new signatures.

## Zero-x validation policy

Zero-x Gasless applies no PistachioSwap token-security policy. It does not call
Honeypot, GoPlus, Moralis security classification, allowlists, blocklists, or
internal token-risk classification. Taxable, upgradeable, unverified, risky,
and scam-like tokens are sent to 0x when their request fields are syntactically
valid. This does not mean 0x verifies or guarantees token safety.

The backend still requires chain 56, a valid wallet and token pair, a
non-native sell token, positive amount, sufficient reported balance, required
decimals and trusted prices, configured economic minimums, acceptable price
impact, 0x liquidity, coherent provider amounts/tokens/recipient/taker,
complete simulation, and a matching integrator fee. Failures are closed before
signatures.

```text
GAS_ASSIST_MODE=disabled
GAS_ASSIST_CHAIN_ID=56
GAS_ASSIST_QUOTE_TTL_SECONDS=45
GAS_ASSIST_MIN_SELL_USD=1
GAS_ASSIST_MIN_USER_OUTPUT_USD=0.10
GAS_ASSIST_MAX_PRICE_IMPACT_BPS=2000
GAS_ASSIST_REJECT_UNLIMITED_PERMITS=false
GAS_ASSIST_FEE_MODE=percent-plus-fixed-capped
GAS_ASSIST_FEE_PERCENT_BPS=300
GAS_ASSIST_FIXED_FEE_USD=0.067
GAS_ASSIST_MAX_FEE_USD=5
GAS_ASSIST_FEE_TOKEN_MODE=sellToken
GAS_ASSIST_STATUS_POLL_INTERVAL_MS=3000
GAS_ASSIST_STATUS_TIMEOUT_MS=120000
GAS_ASSIST_QUOTE_WALLET_LIMIT_PER_HOUR=10
ZEROX_API_KEY=
TREASURY_ADDRESS=
DATABASE_URL=
```

The frontend loads `GET /v1/gas-assist/config` for a connected BNB Chain wallet;
no frontend feature flag is required. API keys, database credentials, and
treasury configuration remain backend-only.

Modes remain explicit: `disabled`, `zero-x-gasless`, and
`megafuel-legacy`. Zero-x mode does not load MegaFuel, NodeReal, paymaster,
custom executor, or custom contract requirements. Legacy checks remain isolated
and unchanged, including its strict security, allowlist/blocklist, sponsor-rule,
amount-limit, and paymaster policy. PistachioSwap does not deploy a custom Gas
Assist contract.

## Database migration

`0001_zero_x_gasless.sql` creates the authoritative quote table.
`0002_gasless_selected_buy_token.sql` broadens its buy-token constraint from
native-only to a normalized nonzero address. Review and apply migrations
manually; application startup does not apply them.

## Manual smoke test

1. Review and apply the pending database migration manually.
2. Configure a 0x key with Gasless v2 access and a safe treasury address.
3. Set `GAS_ASSIST_MODE=zero-x-gasless` and the fee variables above.
4. Start the API and frontend manually.
5. Connect a BNB Chain test wallet with exactly zero native BNB.
6. Confirm USDT to USDC and USDT to native BNB preserve their outputs.
7. Confirm the banner, fee components, expected output, minimum output, and
   countdown are visible before signing.
8. Test existing-allowance, EIP-2612, rejected second signature, ordinary
   on-chain approval, expired quote, and double-submit cases.
9. Fund the wallet with BNB and confirm the next quote returns to `/v1/quote`
   and the normal transaction path.
