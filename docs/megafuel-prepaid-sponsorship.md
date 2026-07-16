# MegaFuel Prepaid Sponsorship

## Scope and safety status

This design adds a prepaid Gas Assist path for BNB Chain (`chainId=56`) without a custom smart contract. It reuses the existing 0x Gasless service for the final trade, the existing provider and token services for evidence, the existing MegaFuel private-policy transport, and PostgreSQL for all durable authorization and accounting state.

The implemented production path is Flow B: a 0x Gasless trade that requires an ordinary on-chain ERC-20 approval. Direct 0x Gasless trades remain on the existing provider-integrator path and do not create a prepaid order. Normal user-funded swaps remain unchanged.

Normal MegaFuel-sponsored swaps are disabled by default. The backend rejects that fallback even if the flag is accidentally enabled until provider-specific Uniswap and PancakeSwap calldata decoding is complete. It never sponsors a generic call.

## Business model

The user's entered sell amount is gross spend. USD accounting uses integer micro-dollars and token accounting uses raw integers.

```text
commercialFeeUsd = min(5.00, 0.067 + tradeNotionalUsd * 0.03)

estimatedSponsoredGasUsd =
  feePaymentTransferGasUsd
  + approvalGasUsd
  + sponsoredNormalSwapGasUsd

gasReserveUsd = estimatedSponsoredGasUsd * 1.50
totalPrepaymentUsd = commercialFeeUsd + gasReserveUsd
```

The $5 cap applies only to the fixed service fee plus the 3% trade fee. Gas reserve is added after the cap and is never capped at $5. Off-chain authentication and 0x typed-data signatures consume no gas and add no gas charge. USD-to-token conversion uses ceiling division.

Prepaid orders use `billingMode=prepaid-megafuel`. A prepaid quote must have a zero 0x integrator fee. The code rejects any attempt to combine `provider-integrator` and `prepaid-megafuel` billing. The 0x `zeroExFee` and `gasFee` remain provider costs and are shown separately.

## Gross and net input

When the selected payment token is the sell token:

```text
netSwapAmountRaw = grossInputAmountRaw - paymentAmountRaw
```

The order is rejected if payment is greater than or equal to gross input, net input is not positive, gross or net USD value is below policy, minimum output is below policy, or the wallet cannot cover the gross amount.

When a different owned payment token is selected, the full gross sell amount remains the swap input. The review displays both token debits. A buy token is never treated as available merely because it is the future output; its pre-trade balance must cover the payment.

## Payment-token selection

Payment tokens are administrator-controlled rows in `sponsorship_payment_tokens`. Symbol text never establishes stability or safety. A candidate must be enabled for fee payment, have matching database and on-chain decimals, current trusted price evidence, acceptable cross-source price deviation, sufficient observed liquidity, exact transfer evidence, acceptable token security, and sufficient current wallet balance. Fee-on-transfer, rebasing, unknown-transfer, stale-price, and low-liquidity tokens fail closed.

Eligible candidates are ordered deterministically:

1. Owned eligible stablecoin.
2. Eligible sell token.
3. Eligible buy token with an existing sufficient balance.
4. Administrator priority.
5. Trusted liquidity.
6. Normalized address.

The frontend never submits a payment token. The order response includes the selected token and a reason.

## Whitelist management

There is no admin UI. Use finite backend CLI commands from the repository root:

```bash
pnpm --filter @pistachio/api sponsor-token:add -- \
  --chain-id 56 \
  --token 0x0000000000000000000000000000000000000001 \
  --symbol TOKEN \
  --decimals 18 \
  --stablecoin \
  --priority 100 \
  --minimum-liquidity-usd 100000 \
  --fee-payment \
  --approval-sponsorship

pnpm --filter @pistachio/api sponsor-token:list
pnpm --filter @pistachio/api sponsor-token:disable -- --token 0x0000000000000000000000000000000000000001
pnpm --filter @pistachio/api sponsor-token:enable -- --token 0x0000000000000000000000000000000000000001
pnpm --filter @pistachio/api sponsor-token:update -- --token 0x0000000000000000000000000000000000000001 --priority 90
pnpm --filter @pistachio/api sponsor-token:remove -- --token 0x0000000000000000000000000000000000000001
```

Add checks deployed bytecode, on-chain decimals, trusted price/liquidity, exact transfer evidence, and strict security evidence. Removal requires the row to be disabled first. CLI output contains public token metadata only.

## Wallet authentication

Orders do not trust a wallet address in JSON. The backend issues a five-minute authentication message containing domain, wallet, chain, nonce, issue time, and expiry. It verifies the recovered address, consumes the challenge once, and returns a short-lived bearer session. Only a hash of the random session token is stored. The frontend keeps the session in memory and does not write it to browser storage.

Message signing authenticates the wallet only. It is never used as a substitute for transaction signing.

## Five-minute orders and one-time intents

Orders and transaction intents default to 300 seconds. Expiry is checked during prepare, before unsigned fields are returned, before signed bytes are accepted, and before MegaFuel submission. A database partial unique index allows one active order per wallet. Each order/action pair is unique, active wallet/nonce pairs are unique, and submission attempts are constrained to one.

Signed raw bytes are parsed locally with Viem. The recovered signer, chain, legacy type, nonce, destination, calldata, calldata hash, zero native value, zero gas price, gas limit, fee fields, access list, and decoded business action must match stored authorization. Any mismatch returns `SIGNED_TRANSACTION_MISMATCH`. Raw signed bytes are forwarded once and are not persisted or logged. An ambiguous provider result becomes `unknown`; the locally derived hash is polled and the transaction is not blindly resent.

## Payment confirmation

The payment intent is exactly:

```text
paymentToken.transfer(TREASURY_ADDRESS, paymentAmountRaw)
value = 0
gasPrice = 0
chainId = 56
```

Preparation rechecks whitelist state, token evidence, decimals, balance, exact payment, gas estimates, nonce, action cap, and MegaFuel sponsorability. A price or gas change that alters the reviewed payment requires a new order.

Submission is not payment. Confirmation requires a successful receipt, exact sender and token target, and one unambiguous `Transfer` event from the authenticated wallet to the treasury for at least the required amount. Short receipts and conflicting logs fail. The MVP whitelist requires exact-transfer behavior.

## Approval and fresh 0x continuation

Approval cannot be prepared until payment is confirmed. The spender comes from 0x allowance metadata and must match a configured Permit2 or AllowanceHolder target. The configured 0x Settler address is explicitly forbidden. Existing allowance is rechecked; sufficient allowance rejects sponsorship.

The default and currently implemented mode is exact approval:

```text
sellToken.approve(authoritativeSpender, netSwapAmountRaw)
```

Maximum `uint256` approval is forbidden. `bounded-reusable` remains fail-closed in this deployment because the frontend and backend do not yet expose a separately audited opt-in path.

After approval confirmation, the prior indicative quote is invalidated. The backend obtains a completely fresh 0x Gasless quote for the exact net input with no PistachioSwap integrator fee. It rejects another approval requirement, an input change, or minimum output below the reviewed slippage boundary. The user then explicitly signs the fresh 0x typed data and submits through the existing 0x Gasless service.

The 0x Gasless final transaction is never included in MegaFuel gas reserve. Its `zeroExFee` and `gasFee` remain visible provider costs.

## Accounting and unused credit

Ledger entries separate gas reserve, commercial-fee reserve, actual gas, fixed service settlement, platform-fee settlement, unused gas credit, wallet credit, and adjustments.

After payment confirmation:

- The disclosed $0.067 service fee is earned.
- Gas reserve funds actual payment and approval gas, including reverted transaction gas.
- The 3% component remains reserved.

After a confirmed swap, the 3% fee is earned. Remaining gas margin becomes non-withdrawable, nontransferable sponsorship credit tied to the authenticated wallet.

If the user abandons later signatures, the fixed service fee and gas actually spent are retained. The unsettled 3% reserve and unused gas margin become wallet-bound sponsorship credit. Provider or PistachioSwap failures preserve unused value the same way. There is no withdrawal or transfer endpoint for credits.

## Abuse controls

PostgreSQL, transactions, row locks, advisory locks, unique constraints, and persisted usage rows enforce:

- One active order per wallet and wallet cooldown.
- Wallet, IP, and global daily order limits.
- Wallet and global daily gas budgets.
- Per-token whitelist limits and per-action gas caps.
- Payment-attempt, revert, expiry, and signature-mismatch thresholds.
- Simulation immediately before preparation and business revalidation before submission.
- Hashed IP addresses; raw IP addresses are not stored by this subsystem.
- Emergency shutdown through `MEGAFUEL_EMERGENCY_DISABLED`.

The commercial fee must exceed estimated payment gas by the configured minimum margin. This reduces deliberate payment-transfer revert abuse but does not eliminate it; private policy limits remain required.

## Private-policy client and defense in depth

The API key and policy UUID remain backend-only. The client constructs the private BSC MegaFuel endpoint from the configured NodeReal base and API key, sends the private policy UUID header and configured User-Agent, checks sponsorability, obtains the pending nonce through the same compatible endpoint, rechecks sponsorability, and forwards only signed raw bytes through `eth_sendRawTransaction`. Provider errors are sanitized.

Before mainnet, confirm the current private endpoint format and header names against the NodeReal account documentation without exposing credentials.

Recommended private-policy settings:

- BSC Mainnet and private policy.
- Active date range and required User-Agent.
- Conservative global gas cap, per-account daily gas, and per-account count.
- Payment and approval token contracts as allowed destinations.
- `transfer(address,uint256)` selector `0xa9059cbb`.
- `approve(address,uint256)` selector `0x095ea7b3`.
- Router destinations/selectors only after normal swap sponsorship is audited and enabled.

Policy matching does not validate transfer recipient/amount, approval spender/amount, route, swap recipient, or minimum output. Backend argument validation remains mandatory.

## Wallet raw-signing limitation

MegaFuel private-policy submission needs a signed raw transaction without wallet broadcasting. Reown AppKit currently exposes external injected, WalletConnect, Coinbase, and other wallet connectors, but this repository has no connector contract that guarantees `eth_signTransaction`.

The frontend therefore reports all external connectors as unsupported and shows:

> This wallet cannot sign a private sponsored transaction without broadcasting it. Use a supported wallet or pay normal BNB gas.

Only explicitly identified `pistachio-embedded` or `pistachio-local` connectors are eligible, and they must expose the exact RPC request method. `personal_sign`, `eth_sign`, and typed-data signing are never substitutes. This keeps the backend ready for a future embedded/local PistachioSwap wallet without making false compatibility claims.

## Threat model

Primary threats are arbitrary-call sponsorship, fee/payment injection, approval of Settler or attacker spenders, signed-transaction mutation, replay and nonce reuse, stale quotes, fee-on-transfer short payment, duplicated forwarding, provider timeout ambiguity, raw transaction leakage, credential leakage, wallet/IP farming, and deliberate reverts.

Controls are backend-authoritative request derivation, normalized addresses, strict whitelist metadata, exact simulations, fixed integer accounting, exact calldata hashes, signer recovery, one-time nonce-bound intents, receipt/event verification, PostgreSQL locking, safe error bodies, log redaction, persisted usage limits, private credentials, and the emergency switch.

## Migration procedure

Migration `apps/api/drizzle/0003_megafuel_prepaid_sponsorship.sql` is generated but must not be applied as part of code validation.

Before a controlled deployment:

1. Back up PostgreSQL and review the SQL, constraints, partial indexes, and triggers.
2. Apply migrations in a maintenance window using the existing migration command.
3. Add disabled whitelist rows and verify public configuration remains disabled.
4. Configure the private policy and backend secrets.
5. Enable one audited token, then enable prepaid sponsorship for a canary cohort.
6. Monitor unknown submissions, reverts, expiries, signature mismatches, gas use, ledger balance, and credit creation.

## Environment configuration

Use backend variables only. The example env contains empty placeholders.

Core activation: `SPONSORSHIP_BILLING_MODE`, `MEGAFUEL_PREPAID_ENABLED`, `MEGAFUEL_CHAIN_ID`, `MEGAFUEL_API_KEY`, `MEGAFUEL_PRIVATE_POLICY_UUID`, `MEGAFUEL_PRIVATE_RPC_BASE_URL`, `MEGAFUEL_USER_AGENT`, `MEGAFUEL_IP_HASH_SECRET`, and `MEGAFUEL_EMERGENCY_DISABLED`.

Economics: order/intent TTL, gas multiplier, fixed fee, platform BPS, commercial cap, gross/net/output minimums, liquidity, price age/deviation, and minimum commercial margin over payment gas.

Actions: approval and normal-swap flags, approval mode, unlimited-approval rejection, safe 0x allowance targets, Settler address, and payment/approval/swap gas caps.

Abuse limits: wallet/IP/global counts, wallet/global gas budgets, cooldown, unpaid attempts, reverts, expiries, and signature mismatches.

Secrets are validated only when prepaid sponsorship is enabled. They are not returned from public endpoints.

## Testnet checklist

- Use a private BSC test policy and isolated PostgreSQL database.
- Keep mainnet prepaid sponsorship disabled.
- Add one audited exact-transfer token through the CLI.
- Confirm token bytecode, decimals, price, liquidity, security, and treasury receipt behavior.
- Exercise direct 0x Gasless and prove no prepaid order is created.
- Exercise ordinary on-chain approval and prove payment confirms first.
- Verify wrong signer, chain, nonce, destination, calldata, value, gas, and access list fail.
- Verify duplicate and concurrent submissions forward once.
- Verify order/intent expiry at five minutes and unknown submission polling.
- Verify short receipt, revert gas, abandonment credit, provider failure credit, and successful 3% settlement.
- Verify external AppKit wallets fail closed and an audited embedded/local connector returns signed raw bytes without broadcasting.
- Inspect logs, browser storage, responses, and network traffic for credentials, signatures, raw transactions, and private endpoints.

## Mainnet rollout checklist

- Complete the testnet checklist with recorded evidence.
- Independently review the migration, fixed-point math, raw transaction parser, and ledger invariants.
- Confirm current official 0x safe allowance targets and Settler address.
- Confirm current NodeReal private endpoint, policy header, nonce method, sponsorability method, and User-Agent policy.
- Keep normal swap sponsorship disabled until provider-specific decoders have independent tests and review.
- Use conservative policy and application caps below economic exposure limits.
- Enable one high-liquidity exact-transfer token and a small canary cohort.
- Reconcile treasury receipts, ledger entries, MegaFuel gas, credits, and 0x completion daily.
- Alert on unknown submissions, reverts, expiries, signature mismatches, failed payments, and budget saturation.
- Test the emergency switch and documented incident procedure before broad enablement.
