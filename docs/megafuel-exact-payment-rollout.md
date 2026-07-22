# MegaFuel pre-signed exact transaction packages

This branch implements a backend-authoritative BNB Chain flow for Pistachio Wallet:

```text
create reviewed order
→ prepare fee transfer, exact approval, and exact swap
→ assign consecutive wallet nonces N, N+1, N+2
→ Pistachio Wallet signs all three complete raw transactions
→ backend validates and atomically stores all three signed raws
→ broadcast fee transfer and confirm exact treasury receipt
→ broadcast exact approval and confirm allowance
→ broadcast exact swap and confirm output transaction
```

The three actions remain separate blockchain transactions and are not atomic. Package storage is atomic only at the database boundary. The backend refuses to broadcast the fee unless all three valid signed raw transactions are stored first.

## Safety defaults

```env
SPONSORSHIP_BILLING_MODE=prepaid
MEGAFUEL_PREPAID_ENABLED=false
MEGAFUEL_EMERGENCY_DISABLED=true
DANGEROUSLY_BYPASS_SPONSORSHIP_TOKEN_CHECKS=false
```

Repository code and ordinary CI do not apply migrations, start services, submit mainnet transactions, modify live MegaFuel policies, or use a private wallet key.

## Fifteen-minute lifetime

Reviewed orders, package intents, the Uniswap deadline, and the post-payment grant use a fifteen-minute lifetime.

```env
MEGAFUEL_ORDER_TTL_SECONDS=900
MEGAFUEL_ACTION_INTENT_TTL_SECONDS=900
```

Expired or nonce-conflicting signed transactions cannot be edited. Pistachio Wallet must sign a newly prepared package.

## Security boundary

The frontend does not choose the treasury, fee amount, approval spender, approval amount, nonce, swap target, calldata, native value, gas limit, or MegaFuel policy. The backend validates:

- signer and BNB Chain ID;
- exact consecutive nonces;
- exact token, target, calldata, amount, and native value;
- exact approval with no unlimited allowance;
- zero gas price and bounded gas limit;
- current balance and allowance;
- order, intent, and provider expiry;
- gas reserve and sponsorship limits;
- the correct fee or action policy.

A partial signed package is never accepted.

## Browserless execution

After package storage, the browser or device connection may disappear. The backend recovery loop advances only after the previous receipt is confirmed:

```text
payment-prepared   → fee-payment-transfer
payment-confirmed  → token-approval
approval-confirmed → normal-swap
```

Recovery may rebroadcast only the exact same stored bytes and never broadcasts a future prepared transaction before its prerequisite receipt.

## Token and route safety

An exact token address enabled in `sponsorship_payment_tokens` is the manual security and transfer-behavior decision. The backend still requires:

- matching on-chain decimals;
- sufficient wallet balance;
- live Alchemy price;
- Moralis reference comparison when available;
- current Moralis or DexScreener liquidity;
- configured price age and deviation limits;
- a safe executable route for about `$0.10` to BNB, USDT, or USDC.

The route probe does not execute a swap. Treasury fee tokens accumulate for later batched settlement.

## Fee calculation

```text
sponsoredGasUsd = feeTransferGasUsd + approvalGasUsd + exactSwapGasUsd
gasReserveUsd = sponsoredGasUsd × 1.5
commercialFeeUsd = $0.067 + 3% of gross trade notional
totalPrepaymentUsd = gasReserveUsd + commercialFeeUsd
gross sell amount - exact fee amount = exact user swap amount
```

The fee is charged in the sell token. Individual orders do not require a tiny fee-token conversion route.

## Debugging

Backend:

```env
DEBUG_SPONSORSHIP_TRACE=true
DEBUG_SPONSORSHIP_PROVIDER_RESPONSES=true
```

Frontend tracing is automatic in Vite development and may be explicitly enabled:

```env
VITE_DEBUG_SPONSORSHIP_TRACE=true
```

Browser-only override:

```js
localStorage.setItem('pistachio:debug-gas-assist', 'true')
```

Tracing includes stage names, elapsed time, HTTP status, request IDs when available, MegaFuel RPC methods, fallback methods, retries, PostgreSQL codes and constraints, order IDs, intent actions, wallet nonces, and stack locations. Authorization, API keys, private keys, session tokens, signatures, signed bytes, and raw transactions are redacted.

The live canary prints numbered start, success, and error events for evidence loading, authentication, order creation, route probing, package preparation, each wallet signature, package storage, polling, cleanup, and shutdown.

## Compact user experience

The user-facing review intentionally shows only:

- amount paid;
- expected amount received;
- exact Gas Assist fee;
- one `Swap without BNB` primary action;
- compact progress and completion states;
- concise user-safe errors.

Exact fee components, minimum output, provider fees, transaction hashes, error code, stage, request ID, and the separate-transaction disclosure remain in the collapsed `Transaction details` section.

## Database migrations

Apply manually through the API migration command:

```text
apps/api/drizzle/0004_megafuel_exact_prepaid_flow.sql
apps/api/drizzle/0005_durable_sponsorship_intents.sql
apps/api/drizzle/0006_presigned_package_fifteen_minute_expiry.sql
apps/api/drizzle/0007_expire_unsigned_canary_orders.sql
apps/api/drizzle/0008_release_stale_sponsorship_nonces.sql
```

```bash
pnpm --filter @pistachio/api db:migrate
```

Migration `0008` releases a nonce only when the old reservation is unsigned, unbroadcast, has zero submission attempts, and belongs to a terminal or safely expired order. Submitted, confirmed, reverted, or unknown transactions are not touched.

## CI validation

Frontend Gas Assist tests run as separate named matrix jobs. Failed test output is uploaded as a short-lived artifact. Lint, API typecheck, API Gas Assist tests, and the production frontend build run independently, so one frontend failure does not hide backend failures.

## Opt-in live XAUT canary

The canary uses BNB Chain XAUT:

```text
0x21caef8a43163eea865baee23b9c2e327696a3bf
```

It performs real transactions and spends real XAUT and sponsorship funds. Use only a funded disposable wallet. Never commit the key or paste it into chat.

```bash
cd apps/api
set -a
source .env
set +a

RUN_XAUT_PRESIGNED_CANARY=true \
EXPIRE_AFTER_ERROR=true \
DEBUG_SPONSORSHIP_TRACE=true \
XAUT_TEST_PRIVATE_KEY='0xYOUR_LOCAL_TEST_PRIVATE_KEY' \
XAUT_TEST_WALLET_ADDRESS='0xYOUR_TEST_WALLET_ADDRESS' \
pnpm exec vitest run test/xaut-presigned-package.live.test.ts --reporter=verbose
```

No API server is required because the canary uses Fastify `app.inject`.

## Production gate

Do not enable public traffic until:

- all migrations are applied to the intended database;
- exact payment rejection occurs before paymaster submission;
- the route-safety probe succeeds;
- the XAUT canary confirms payment, approval, and swap;
- browser loss is tested after package storage and after each broadcast;
- expired, reverted, and unknown-submission behavior is verified;
- refunds are manually reconciled;
- dangerous bypasses remain disabled;
- no test key exists in source control or shared logs.
