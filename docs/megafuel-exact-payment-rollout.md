# MegaFuel exact payment rollout

This branch hardens the prepaid fee-payment and approval stages. It does not enable generic MegaFuel-sponsored swaps.

## Security boundary

The browser never chooses the payment token, treasury, raw amount, nonce, gas limit, or calldata. The backend prepares a legacy BNB Chain transaction with zero gas price. Pistachio Wallet signs the complete transaction without broadcasting it. The backend parses the signed bytes, recovers the signer, compares every field with the stored one-time intent, decodes the ERC-20 call, and submits only an exact match through the private MegaFuel policy.

A user-created dust transfer, underpayment, overpayment, changed recipient, changed token, changed nonce, changed gas limit, or changed calldata is rejected before `eth_sendRawTransaction` is called.

## Private policy settings

Use one private BSC Mainnet policy. Keep the API key and policy UUID in `apps/api/.env` only.

Recommended whitelist entries:

- `ToAccountWhitelist`: enabled payment and approval token contracts.
- `ContractMethodSigWhitelist`: `0xa9059cbb` and `0x095ea7b3`.
- `BEP20ReceiverWhiteList`: the configured treasury address.

The localhost admin API synchronizes these values. The policy remains defense in depth. Exact calldata arguments are still enforced by the backend.

## Environment

Copy the relevant values from `apps/api/.env.megafuel.example` into `apps/api/.env`. Keep:

```text
MEGAFUEL_EMERGENCY_DISABLED=true
MEGAFUEL_PREPAID_ENABLED=false
```

until migration and tests are complete.

Generate the local admin token with:

```bash
openssl rand -hex 32
```

Store it as `SPONSORSHIP_ADMIN_TOKEN` in the backend environment.

## Database

Review and apply this migration manually in a maintenance window:

```text
apps/api/drizzle/0004_megafuel_exact_prepaid_flow.sql
```

It adds:

- a two-minute payment-quote timestamp,
- a fee-confirmation timestamp,
- a fresh five-minute post-payment grant timestamp,
- token-to-BNB conversion-cost accounting storage.

The migration has not been applied by repository code or CI.

## Local token API

The API accepts only localhost connections and a bearer token.

List tokens:

```bash
curl -s http://127.0.0.1:3001/admin/sponsorship/tokens \
  -H "Authorization: Bearer $SPONSORSHIP_ADMIN_TOKEN"
```

Add a token:

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
    "normalSwapSponsorshipEnabled":false,
    "isStablecoin":false,
    "priority":100,
    "minimumLiquidityUsd":"0",
    "minimumGrossTradeUsd":"1",
    "maximumPriceAgeSeconds":300,
    "maximumPriceDeviationBps":300
  }'
```

Disable a token before removing it:

```bash
curl -sS -X PATCH \
  http://127.0.0.1:3001/admin/sponsorship/tokens/0x0000000000000000000000000000000000000001 \
  -H "Authorization: Bearer $SPONSORSHIP_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"enabled":false}'
```

Remove it:

```bash
curl -sS -X DELETE \
  http://127.0.0.1:3001/admin/sponsorship/tokens/0x0000000000000000000000000000000000000001 \
  -H "Authorization: Bearer $SPONSORSHIP_ADMIN_TOKEN"
```

Synchronize all enabled rows to MegaFuel:

```bash
curl -sS -X POST http://127.0.0.1:3001/admin/sponsorship/tokens/sync \
  -H "Authorization: Bearer $SPONSORSHIP_ADMIN_TOKEN"
```

## Required validation

Run without starting either server:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm --filter @pistachio/api typecheck
pnpm --filter @pistachio/api test
pnpm build
```

Do not enable the private policy path until the exact-payment tests pass and a test wallet proves that a signed dust transfer is rejected before the paymaster submission mock is called.

## Deliberately disabled

The final generic MegaFuel-sponsored swap is still disabled. The existing post-approval 0x Gasless continuation remains in place. Exact normal-swap target validation, swap gas reservation, receipt settlement, and refund processing require a separate audited change before mainnet activation.
