# Same-Chain Swap

## Purpose and flow

Owns frontend same-chain quote request handling.

```text
Token and amount input -> create request -> fetch /v1/quote
-> normalize canonical approval metadata -> cache short-lived response
-> review state -> execution hook -> normal approval -> refresh -> simulate -> submit
```

## Responsibilities

Create validated request bodies, normalize response addresses and approval
metadata, reject stale results, and manage the in-memory quote cache.

`hooks/useSameChainExecution.js` owns the confirmed execution sequence and its
synchronous duplicate-confirm guard. It calls the approvals feature, validates
force-refreshed quotes, extracts the exact executable transaction, runs the
existing read-only simulation, and calls the wallet sender supplied by App.

## Not here

Wallet authorization is in `features/approvals`; Gas Assist and cross-chain
requests are separate feature paths. UI composition is owned by focused
components under `components/`, with state composed by `useSwapController`.

## Important files and exports

`services/quotes.js` exports `createQuoteRequestBody`, `isCurrentQuoteResponse`,
`normalizeQuoteResponse`, `fetchSwapQuote`, and test cache helpers. Inputs and
outputs retain the current `/v1/quote` JSON contract. `model/sameChainReviewEligibility.js`
is the pure review gate; `hooks/useSameChainReview.js` owns dialog state,
captured request identity, focus restoration, and review DOM diagnostics;
`components/SameChainReviewDialog.jsx` owns the unchanged Radix portal markup.
`services/executableTransaction.js` owns pure calldata/chain/token/account and
expiry validation. `services/refreshedQuoteValidation.js` binds refreshed
provider, amount, approval, and transaction metadata to the captured intent.

## Dependencies, side effects, errors, logging, testing

Depends on Viem address validation and curated-chain configuration. It performs
the browser HTTP request, reads/writes a bounded in-memory cache, and logs the
existing approval-metadata diagnostics. Invalid request/approval data and HTTP
errors reject. `services/quotes.test.js` mocks fetch and timers; it does not
prove real provider availability. Manual changes must preserve cache identity,
force-refresh, abort signal, and `approvalSchemaVersion` behavior.

## Execution and receipt boundary

Confirmation uses this fixed order: duplicate guard, approval preparation,
conditional force refresh, refreshed-intent validation, transaction extraction,
simulation, optional one-attempt Permit2 `AllowanceExpired` recovery, final
simulation, and wallet submission. Recovery invalidates Permit2 readiness,
refreshes, prepares approval with that response, refreshes again if an approval
transaction elapsed, and never loops.

`hooks/useSameChainReceiptLifecycle.js` owns transaction hash/status, Wagmi
receipt polling, once-only success/failure effects, review closure, input and
quote invalidation, and balance refresh through semantic callbacks. Receipt
completion remains separate from confirmation orchestration.

The preserved diagnostic sequence includes `review.confirm.*`,
`approval.prepare.*`, `quote.refresh.after-approval.*`, `simulation.*`,
`approval.permit2.recovery.*`, and `transaction.send.*` events.

## Security and testing limits

Canonical approval metadata is validated before it reaches the approval hook.
Review opening cannot call a wallet or RPC operation. Focused execution tests
mock the approval hook, quote fetch, public client/simulation, and wallet sender;
they prove orchestration contracts only, not live wallet, RPC, Permit2,
PancakeSwap, Uniswap, or 0x behavior. Common manual edits should keep the order,
event names, visible messages, and captured-intent comparisons unchanged.

## Page composition and controller

`hooks/useSwapController.js` composes focused hooks and returns grouped `header`
and `page` view models. It does not reimplement quote, approval, receipt, Gas
Assist, or cross-chain internals. `components/SwapPage.jsx` and `SwapCard.jsx`
compose presentation components; detailed component contracts are in
`components/README.md`.

## Input and quote ownership

- `hooks/useSwapInputs.js`: selected tokens, token/USD amounts, active exact side,
  switching, denomination, quick amounts, raw/display conversion, and success reset.
- `hooks/useSwapQuote.js`: quote state/refs, request and logical identity, debounce,
  AbortController cleanup, stale response rejection, normalization, previous-quote
  retention, provider recommendation, refresh, and execution-safe quote application.
- `model/swapEligibility.js`: pure funds/economic/review/CTA derivation.
- `model/swapViewModel.js`: pure grouped presentation contracts.

## Public hook contracts

`useSwapController()` returns `{layoutStyle, header, page}`. `useSwapInputs(config)`
returns token/amount/denomination state plus semantic mutation functions.
`useSwapQuote(config)` returns quote/status/snapshot, refresh/reset/invalidate
operations, and safe refreshed-quote accessors. `useSameChainReceiptLifecycle`
returns hash/status setters and reset. Hook effects, cleanup, diagnostics, errors,
and mocked limits are documented in JSDoc and focused tests.
