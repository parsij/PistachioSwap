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

The three actions remain separate blockchain transactions and are not atomic. The package submission is atomic only at the database boundary: the backend refuses to broadcast the fee unless all three valid signed raw transactions have been stored first.

The example configuration keeps the feature disabled and emergency-locked. Repository code and CI do not apply migrations, start services, submit mainnet transactions, or modify live MegaFuel policy settings.

## Fifteen-minute lifetime

New reviewed orders, package intents, the Uniswap transaction deadline, and the post-payment grant use a fifteen-minute lifetime.

```text
MEGAFUEL_ORDER_TTL_SECONDS=900
MEGAFUEL_ACTION_INTENT_TTL_SECONDS=900
```

The Uniswap `/swap` request includes an explicit Unix deadline. The backend requires enough lifetime to remain before it accepts the package for signing. An expired signed swap cannot be changed or replaced by the backend; Pistachio Wallet must sign a newly prepared package.

## Security boundary

The frontend does not choose the payment token, treasury, payment amount, approval spender, approval amount, nonce, swap target, swap calldata, native value, gas limit, or MegaFuel policy.

Before accepting the package, the backend validates every signed raw transaction against its stored intent:

- recovered signer and chain ID;
- exact consecutive nonces;
- exact token, target, calldata, amount, and native value;
- exact approval with no unlimited allowance;
- zero gas price and bounded gas limit;
- current balance and allowance state;
- current order, intent, and provider expiry;
- funded gas reserve and wallet, IP, and global sponsorship limits;
- correct fee or action MegaFuel policy.

The backend stores the three raw transactions in one database transaction. A partial package is never accepted.

## Sequential browserless execution

After package storage, the browser, page, device connection, or frontend process may disappear. The backend recovery loop runs every five seconds and advances only the action unlocked by confirmed prior state:

```text
payment-prepared  → fee-payment-transfer
payment-confirmed → token-approval
approval-confirmed → normal-swap
```

Approval and swap remain in `prepared` state until their prerequisite receipt confirms. The durable recovery worker only reconciles or rebroadcasts intents already marked `submitting`, `submitted`, or `unknown`, so a stored future transaction cannot be broadcast early.

For every transaction, the backend stores:

- the exact signed raw bytes;
- the expected transaction hash;
- signing, first-broadcast, latest-broadcast, submission, and finalization timestamps;
- a bounded broadcast-attempt count;
- append-only lifecycle events.

Recovery may rebroadcast only the exact same signed bytes, up to three attempts. The signature fixes the signer, nonce, target, calldata, value, gas limit, and transaction hash.

`MEGAFUEL_EMERGENCY_DISABLED=true` blocks new submissions and rebroadcasts. Receipt reconciliation remains available so transactions already on-chain can still be recorded.

## Whitelisted token evidence

An exact address enabled in `sponsorship_payment_tokens` is the security and transfer-behavior trust decision. Sponsorship eligibility no longer depends on Honeypot simulation.

The backend still requires live market evidence:

- Alchemy token price;
- price-deviation comparison when a Moralis reference price exists;
- liquidity equal to the larger available value from Moralis or DexScreener;
- configured minimum liquidity;
- matching on-chain and configured decimals;
- sufficient wallet balance.

Moralis security fields remain diagnostic data but do not override the explicit database whitelist.

Keep this disabled during normal operation:

```text
DANGEROUSLY_BYPASS_SPONSORSHIP_TOKEN_CHECKS=false
```

When enabled, it additionally bypasses live liquidity, price-age, and price-deviation gates. It is not required merely because an external scanner dislikes a legitimate whitelisted token.

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

When the payment token is also the sell token, the exact prepayment is deducted before preparing the signed swap:

```text
gross sell amount - exact fee amount = exact swap amount
```

## Two private MegaFuel policies

Use two distinct private BSC Mainnet policies with the same NodeReal API key.

### Fee policy

Used only for `fee-payment-transfer`:

- enabled payment-token contracts in `ToAccountWhitelist`;
- `0xa9059cbb` in `ContractMethodSigWhitelist`;
- configured treasury in `BEP20ReceiverWhiteList`.

### Action policy

Used only for `token-approval` and `normal-swap`:

- enabled sell-token contracts and the validated swap target;
- `0x095ea7b3` and the exact validated swap selector;
- no treasury receiver rule and no ERC-20 transfer selector.

Policy matching is defense in depth. Backend validation remains authoritative.

## Database migrations

Review and apply these migrations manually, in order:

```text
apps/api/drizzle/0004_megafuel_exact_prepaid_flow.sql
apps/api/drizzle/0005_durable_sponsorship_intents.sql
apps/api/drizzle/0006_presigned_package_fifteen_minute_expiry.sql
```

Migration `0004` adds exact prepaid order, grant, conversion, and refund fields.

Migration `0005` adds durable signed-raw storage, lifecycle timestamps, bounded recovery attempts, the recovery index, append-only intent events, and required ledger entry types.

Migration `0006` changes the post-payment grant to fifteen minutes.

The Drizzle schema describes the durable intent fields, recovery constraints, and `sponsorship_intent_events` table. Neither application startup nor CI applies migrations.

## Validation

The normal repository workflow runs without starting either server and includes:

```bash
pnpm lint
pnpm exec vitest run \
  src/features/gas-assist/services/rawTransactionSigning.test.js \
  src/features/gas-assist/services/rawTransactionSigning.package.test.js \
  src/features/gas-assist/hooks/usePrepaidSponsorship.test.jsx \
  src/features/gas-assist/components/GasAssistPrepaymentDialog.test.jsx

pnpm --filter @pistachio/api typecheck
pnpm --filter @pistachio/api exec vitest run \
  test/prepaid-sponsorship.test.ts \
  test/megafuel-durable-intents.test.ts \
  test/megafuel-exact-payment.test.ts \
  test/megafuel-normal-swap.test.ts \
  test/megafuel-presigned-package.test.ts \
  test/megafuel-two-policy.test.ts \
  test/token-evidence-exact-transfer.test.ts

pnpm build
```

The live-money XAUT canary is intentionally excluded from CI.

## Opt-in live XAUT canary

The live test uses the XAUT BNB Chain contract:

```text
0x21caef8a43163eea865baee23b9c2e327696a3bf
```

It fetches the live price and decimals, calculates approximately `$0.21` of XAUT, verifies live liquidity, creates a real order, prepares the three-transaction package, signs through the same frontend package-signing function, submits the package, and polls until all three transaction hashes confirm.

Run it only with a funded disposable BSC Mainnet wallet. It performs real transactions and spends XAUT and sponsorship funds. Keep the private key only in the local shell or ignored local environment file. Never commit it or paste it into chat.

```bash
cd apps/api
set -a
source .env
set +a

RUN_XAUT_PRESIGNED_CANARY=true \
XAUT_TEST_PRIVATE_KEY='0xYOUR_LOCAL_TEST_PRIVATE_KEY' \
XAUT_TEST_WALLET_ADDRESS='0xYOUR_TEST_WALLET_ADDRESS' \
pnpm exec vitest run test/xaut-presigned-package.live.test.ts --reporter=verbose
```

No API server needs to be started for this canary because it uses Fastify `app.inject`. The frontend and backend development servers remain under operator control.

## Production gate

Do not enable the path for public users until:

- migrations `0004`, `0005`, and `0006` are applied to the intended database;
- exact payment rejection is observed before any paymaster call;
- the XAUT canary completes payment, approval, and swap;
- browser loss is tested immediately after package storage and after each broadcast;
- expired package and reverted approval/swap behavior is verified;
- pending refund accounting is reconciled manually;
- `DANGEROUSLY_BYPASS_SPONSORSHIP_TOKEN_CHECKS=false`;
- no test private key exists in source control, logs, shell history intended for sharing, or support messages.
