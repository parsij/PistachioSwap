# API Same-Chain Quotes

## Purpose and flow

Provides the stable `POST /v1/quote` and `POST /v1/swap/build` contracts.

```text
HTTP request -> schema validation -> concurrent provider quotes
-> normalized quote validation -> unchanged ranking -> response and intent
```

## Responsibilities and boundaries

`routes/quote-routes.ts` registers HTTP endpoints; `schemas/quote-utils.ts`
validates request/normalized responses; `services/quote-selector.ts` handles
concurrency, diagnostics, and ranking; `providers/` adapts PancakeSwap,
Uniswap, and 0x; `types/` defines the shared contract.

Gas Assist intent persistence is called by the route but Gas Assist pricing,
signatures, sponsorship, and submission remain in `apps/api/src/gas-assist/`.

## Data, dependencies, side effects, errors, and logs

Input is the existing quote request JSON. Output is the existing normalized
selection with `approvalSchemaVersion` and canonical approval metadata. This
feature uses configured provider HTTP/RPC clients at runtime, persists a
compatible intent, and preserves `approval.metadata.api-response` plus provider
diagnostics. Validation/provider failures are mapped with `getSafeError`.

## Testing and manual edits

`apps/api/test/quotes.test.ts` is mocked API/provider coverage. It does not
prove live PancakeSwap, Uniswap, 0x, RPC, or fee behavior. Preserve provider
order, native-token normalization, exact spender binding, Permit2 policy, and
all route JSON fields when editing.

## Security and known debt

Credentials are server-only. Canonical approval metadata must remain bound to
the token, spender, contract, amount, chain, and executable transaction.
Provider selector concurrency and ranking are still one module because moving
them independently would risk diagnostic and priority drift.
