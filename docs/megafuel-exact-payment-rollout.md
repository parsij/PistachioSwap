# MegaFuel exact prepaid flow

This branch implements a backend-authoritative BNB Chain flow for Pistachio Wallet:

```text
2-minute fee quote
→ exact sponsored ERC-20 payment to treasury
→ confirmed exact receipt
→ fresh 5-minute grant
→ exact sponsored ERC-20 approval
→ fresh provider quote
→ exact sponsored swap transaction
```

The sponsored provider order is configured by `MEGAFUEL_SPONSORED_SWAP_PROVIDERS`. Uniswap is attempted first and 0x AllowanceHolder/Settler can be used as a configured fallback. PancakeSwap is excluded from this exact flow while its route requires a separate Permit2 authorization.

The example configuration keeps the feature disabled and emergency-locked. Repository code and CI never apply migrations or submit mainnet transactions automatically.

## Security boundary

The frontend never chooses the payment token, treasury, raw payment amount, approval target, approval amount, blockchain nonce, swap target, swap calldata, native value, or gas limit.

For every sponsored action:

1. The backend creates a one-time database intent.
2. The backend prepares a legacy BNB Chain transaction with `gasPrice=0`.
3. Pistachio Wallet reviews and signs the complete raw transaction without broadcasting it.
4. The backend parses the returned bytes and recovers the signer.
5. Every field must match the stored intent exactly.
6. The backend stores the validated raw bytes and expected transaction hash.
7. The backend revalidates the business action and gas reserve.
8. Only the backend submits the exact signed bytes through the correct private MegaFuel policy.

A dust payment, underpayment, overpayment, changed recipient, changed token, changed nonce, changed gas limit, changed approval, changed swap target, changed calldata, or changed signed bytes is rejected before the paymaster submission.

## Durable browser-loss recovery

The fee payment, approval, and swap each have their own one-time intent and independently stored signed raw transaction.

After Pistachio Wallet sends a valid signed raw transaction to the API, the backend can continue even if the page, browser, device connection, or frontend process disappears. The backend:

- stores the exact signed bytes before the route broadcasts them;
- stores the expected transaction hash;
- records first and latest broadcast timestamps;
- records a bounded broadcast-attempt count;
- checks the public chain for the expected hash and receipt;
- may rebroadcast only the exact same signed bytes, up to three attempts;
- reconciles confirmed payment, approval, swap, gas usage, failure, and refund state;
- runs a recovery pass every five seconds while sponsorship is enabled.

Rebroadcasting the exact same bytes cannot create a different action. The signer, nonce, recipient, calldata, value, gas limit, and transaction hash are already fixed by the signature.

The backend cannot sign a future step for the wallet. If the browser closes before Pistachio Wallet signs the approval or swap intent, the user must reconnect and continue from the SQL-backed current step. Approval and swap also cannot safely be pre-signed at order creation because they depend on confirmed prior state, fresh nonces, and a fresh provider quote.

`MEGAFUEL_EMERGENCY_DISABLED=true` stops new sponsored submissions and recovery rebroadcasts. Receipt reconciliation remains available through authenticated order polling so already-mined transactions can be recorded safely.

## SQL history

Migration `0005_durable_sponsorship_intents.sql` adds lifecycle fields to `sponsorship_transaction_intents` and an append-only `sponsorship_intent_events` table.

The event table records:

- `intent-created`;
- `raw-transaction-received`;
- `broadcast-attempted`;
- `transaction-hash-recorded`;
- `status-changed`.

Each event includes the intent, order, action, current status, previous status when applicable, transaction hash, structured details, and timestamp. The order row remains the current aggregate state; the event table provides the audit timeline.

## Fee calculation

The backend calculates:

```text
sponsoredGasUsd =
    feeTransferGasUsd
  + approvalGasUsd
  + exactSwapGasUsd

gasReserveUsd = sponsoredGasUsd × 1.5

commercialFeeUsd = $0.067 + 3% of gross trade notional

totalPrepaymentUsd =
    gasReserveUsd
  + commercialFeeUsd
  + estimated payment-token-to-BNB conversion cost
```

The conversion estimate includes route loss, conversion swap gas, and conversion approval gas. USD values are converted to the selected payment token with integer arithmetic and ceiling division. When the payment token is also the sell token, the exact prepayment is deducted from the gross input before the final sponsored swap quote is created.

## Two private policies

Use two separate private BSC Mainnet policies with the same NodeReal API key and different policy UUIDs. Keep every credential in `apps/api/.env` only.

### Fee policy

The fee policy is used only for the two-minute upfront payment intent.

Recommended entries:

- `ToAccountWhitelist`: enabled fee-payment token contracts only.
- `ContractMethodSigWhitelist`: `0xa9059cbb` for `transfer(address,uint256)` only.
- `BEP20ReceiverWhiteList`: the configured treasury address only.

The backend routes only `fee-payment-transfer` intents through `MEGAFUEL_FEE_POLICY_UUID`.

### Action policy

The action policy is used only after the exact payment receipt confirms and the fresh five-minute grant begins.

Recommended entries:

- `ToAccountWhitelist`: enabled approval-token contracts plus the validated swap target.
- `ContractMethodSigWhitelist`: `0x095ea7b3` for exact approval and the selector from the validated fresh provider quote.
- No treasury receiver whitelist and no ERC-20 transfer selector.

The backend routes `token-approval` and `normal-swap` intents through `MEGAFUEL_ACTION_POLICY_UUID`. The local admin API synchronizes fee-payment tokens only to the fee policy and approval tokens only to the action policy. Swap preparation adds the validated target and exact selector only to the action policy.

Policy matching is defense in depth. Exact calldata arguments, amounts, nonces, gas limits, targets, signed bytes, and expiry remain enforced by the backend before submission.

## Environment

Copy values from `apps/api/.env.megafuel.example` into `apps/api/.env`. Keep these disabled during review:

```text
MEGAFUEL_PREPAID_ENABLED=false
MEGAFUEL_EMERGENCY_DISABLED=true
```

Generate the localhost admin token with:

```bash
openssl rand -hex 32
```

Store it as `SPONSORSHIP_ADMIN_TOKEN` in the backend environment. Set both `MEGAFUEL_FEE_POLICY_UUID` and `MEGAFUEL_ACTION_POLICY_UUID`, and make sure they are different. Never use a `VITE_` variable for NodeReal credentials or the admin token.

## Database

Review and apply both migrations manually, in order, during a maintenance window:

```text
apps/api/drizzle/0004_megafuel_exact_prepaid_flow.sql
apps/api/drizzle/0005_durable_sponsorship_intents.sql
```

Migration `0004` adds:

- the two-minute payment quote timestamp;
- the fee-confirmation timestamp;
- the fresh five-minute post-payment grant timestamp;
- conversion-cost accounting;
- pending refund records.

Migration `0005` adds:

- exact signed raw-transaction storage per intent;
- signing, broadcast, submission, and finalization timestamps;
- bounded recovery broadcast attempts;
- a recovery index;
- append-only intent events and lifecycle triggers;
- ledger entry types used by the exact prepaid accounting flow.

Neither migration is applied by application startup or CI.

## Local token API

These routes accept only localhost connections with:

```http
Authorization: Bearer $SPONSORSHIP_ADMIN_TOKEN
```

List tokens:

```bash
curl -s http://127.0.0.1:3001/admin/sponsorship/tokens \
  -H "Authorization: Bearer $SPONSORSHIP_ADMIN_TOKEN"
```

Add and synchronize a token:

```bash
curl -sS -X POST http://127.0.0.1:3001/admin/sponsorship/tokens \
  -H "Authorization: Bearer $SPONSORSHIP_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{
    "address":"0x0000000000000000000000000000000000000001",
    "symbol":"TOKEN",
    "decimals":18,
    "enabled":true,
    "feePaymentEnabled":true,
    "approvalSponsorshipEnabled":true,
    "normalSwapSponsorshipEnabled":true,
    "isStablecoin":false,
    "priority":100,
    "minimumLiquidityUsd":"0",
    "minimumGrossTradeUsd":"1",
    "maximumPriceAgeSeconds":300,
    "maximumPriceDeviationBps":300
  }'
```

Synchronize all enabled tokens:

```bash
curl -sS -X POST http://127.0.0.1:3001/admin/sponsorship/tokens/sync \
  -H "Authorization: Bearer $SPONSORSHIP_ADMIN_TOKEN"
```

## Failure refunds

After a confirmed upfront payment, approval or swap failure creates one pending refund record:

```text
refundable token amount =
    received payment
  - actual sponsored gas converted to the payment token
  - estimated refund-transfer gas converted to the payment token
```

The fixed `$0.067`, the 3% charge, unused 1.5× reserve, and unused conversion reserve are not retained on a failed order.

No treasury private key is placed on the API server. Refund broadcasting remains an operator action. The local API lists pending refunds and records a separately sent refund transaction hash:

```bash
curl -s http://127.0.0.1:3001/admin/sponsorship/refunds?status=pending \
  -H "Authorization: Bearer $SPONSORSHIP_ADMIN_TOKEN"
```

## Validation

The repository workflow runs without starting either server:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm exec vitest run \
  src/features/gas-assist/services/rawTransactionSigning.test.js \
  src/features/gas-assist/hooks/usePrepaidSponsorship.test.jsx \
  src/features/gas-assist/components/GasAssistPrepaymentDialog.test.jsx
pnpm --filter @pistachio/api typecheck
pnpm --filter @pistachio/api exec vitest run \
  test/prepaid-sponsorship.test.ts \
  test/megafuel-durable-intents.test.ts \
  test/megafuel-exact-payment.test.ts \
  test/megafuel-normal-swap.test.ts \
  test/megafuel-two-policy.test.ts
pnpm build
```

Do not enable the policy path until both migrations are reviewed and applied to a test database, exact-payment rejection is observed before the paymaster call, exact approval and swap complete with a canary wallet, browser-loss recovery is tested after each signed step, and failure refund accounting is reconciled manually.
