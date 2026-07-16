# Gas Assist

Gas Assist is a separate BNB Smart Chain swap path. Normal swaps continue to use
`POST /v1/quote`, compare 0x Swap API, Uniswap, and PancakeSwap, and are paid for
with the user's BNB.

In `zero-x-gasless` mode, Gas Assist uses only 0x Gasless API v2. It sells a
non-native BEP-20 token and buys native BNB (the 0x
`0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` representation). 0x pays native
gas up front and charges the gas fee through the sell-token trade. No custom
PistachioSwap executor contract is required.

## Approval behavior

- Existing allowance: 0x returns no approval object. The wallet signs only the
  trade EIP-712 object.
- Gasless approval available: the wallet signs the exact EIP-2612 object from
  0x, then signs the trade object. The backend submits nothing until both
  signatures are present.
- On-chain approval required: Gas Assist returns `ONCHAIN_APPROVAL_REQUIRED`.
  It does not use MegaFuel or spend PistachioSwap BNB as a fallback.

0x may return a permit value larger than the sell amount, including
`uint256.max`. The UI displays the returned permit amount and an unlimited
permit warning. Set `GAS_ASSIST_REJECT_UNLIMITED_PERMITS=true` to reject those
quotes. Typed-data fields are never changed.

## Safety and economics

The backend requires chain 56, an exact nonzero wallet and token, sufficient
on-chain balance, deployed token bytecode, strict existing Moralis/GoPlus/
Honeypot classification, trusted sell-token and BNB prices, nonzero 0x
liquidity, complete simulation, no fee-on-transfer metadata, and native BNB as
the exact trade recipient output. High-risk, blocked, spam, paused, blacklist,
taxed, unknown, or otherwise nonstandard tokens fail closed.

`GAS_ASSIST_MIN_SELL_USD`, `GAS_ASSIST_MIN_USER_OUTPUT_USD`, and
`GAS_ASSIST_MAX_PRICE_IMPACT_BPS` are evaluated with integer-scaled decimal
arithmetic. Raw token amounts remain decimal integer strings.

PistachioSwap's fee is sent to 0x as `swapFeeRecipient`, `swapFeeBps`, and
`swapFeeToken`. The recipient and BPS come only from `TREASURY_ADDRESS` and
`PLATFORM_FEE_BPS`; `GAS_ASSIST_FEE_TOKEN_MODE=sellToken` is the supported
policy. A configured nonzero fee must appear in the authoritative 0x response.
Normal provider-affiliate fees are not applied again to Gas Assist.

## Public API

- `GET /v1/gas-assist/config`
- `POST /v1/gas-assist/price`
- `POST /v1/gas-assist/quote`
- `POST /v1/gas-assist/submit`
- `GET /v1/gas-assist/status/:tradeHash`

The browser receives signing data but never receives `ZEROX_API_KEY`. Submit
accepts only an internal quote ID plus approval/trade signatures. The backend
reloads authoritative typed data, verifies both EOA signatures with Viem,
splits each signature into 0x EIP-712 signature type 2, reserves the quote in a
database transaction, and submits the stored objects. Signature hashes, not
raw signatures, are persisted. Fastify redacts signature fields.

Quotes use the earliest of their EIP-712 deadline and the configured short
TTL. Refreshing a quote invalidates earlier signatures. Status polling is
accepted only for a trade hash already stored by this PistachioSwap instance.

## Configuration

```text
GAS_ASSIST_MODE=disabled
ZEROX_API_KEY=
ZEROX_API_BASE_URL=https://api.0x.org
DATABASE_URL=
GAS_ASSIST_CHAIN_ID=56
GAS_ASSIST_QUOTE_TTL_SECONDS=45
GAS_ASSIST_MIN_SELL_USD=1
GAS_ASSIST_MIN_USER_OUTPUT_USD=0.10
GAS_ASSIST_MAX_PRICE_IMPACT_BPS=2000
GAS_ASSIST_REQUIRE_STRICT_TOKEN_SECURITY=true
GAS_ASSIST_REJECT_UNLIMITED_PERMITS=false
GAS_ASSIST_FEE_TOKEN_MODE=sellToken
GAS_ASSIST_STATUS_POLL_INTERVAL_MS=3000
GAS_ASSIST_STATUS_TIMEOUT_MS=120000
GAS_ASSIST_QUOTE_WALLET_LIMIT_PER_HOUR=10
PLATFORM_FEE_BPS=45
TREASURY_ADDRESS=
```

Only `VITE_GAS_ASSIST_ENABLED=true` is public frontend configuration. Keep the
0x key and database URL backend-only.

Modes:

- `disabled`: Gas Assist execution routes fail closed; normal startup and swaps
  do not require Gas Assist configuration or PostgreSQL.
- `zero-x-gasless`: active architecture described here. MegaFuel and the old
  PistachioSwap spender assumptions are not loaded.
- `megafuel-legacy`: deprecated approval-only internals remain isolated for an
  intentional rollback. The 0x Gasless endpoints do not call them, and their
  old contract, rule, and paymaster checks are not weakened.

## Database migration

Apply migrations manually after reviewing the target database:

```bash
pnpm --filter @pistachio/api db:migrate
```

`0001_zero_x_gasless.sql` adds `gas_assist_gasless_quotes`, including the
authoritative approval/trade JSON, amounts, fee and route evidence, expiry,
atomic status, signature hashes, 0x identifiers, and transaction hashes.

## Manual operation

1. Configure PostgreSQL and apply the migration.
2. Configure a 0x key with Gasless API access.
3. Set `GAS_ASSIST_MODE=zero-x-gasless`, treasury, fee BPS, and safety limits.
4. Start the API and frontend manually.
5. Enable `VITE_GAS_ASSIST_ENABLED=true` in the frontend environment.

On rejection of either wallet signature, the browser cancels locally and calls
no submit endpoint. On quote expiry, obtain a new quote and restart both
signatures. On a provider or validation inconsistency, Gas Assist fails closed;
the separate normal user-paid swap remains available.

### Manual smoke test

Perform these steps only after deliberately configuring a test wallet and real
provider access:

1. Configure PostgreSQL and apply the migration.
2. Configure a 0x API key with Gasless API enabled.
3. Set Gas Assist mode to `zero-x-gasless`.
4. Configure the treasury and fee BPS.
5. Start the API manually.
6. Start the frontend manually.
7. Connect a BNB Chain wallet.
8. Test a token with an existing Permit2 allowance.
9. Test an EIP-2612 token without an existing allowance.
10. Confirm two signatures produce one submitted trade.
11. Reject the second signature and confirm nothing is submitted.
12. Test a token that requires an on-chain approval.
13. Confirm it fails before submission.
14. Test a sub-$1 amount.
15. Confirm it fails before signatures.
16. Confirm native BNB arrives after a successful test.
17. Confirm the treasury receives the configured fee.
18. Confirm the UI displays gas, 0x, and integrator fees.
