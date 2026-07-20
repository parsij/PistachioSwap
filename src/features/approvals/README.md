# Normal Swap Approvals

## Purpose

Owns paid same-chain ERC-20 and Permit2 authorization. It is intentionally
separate from Gas Assist and its gasless/prepaid paths.

## Flow

```text
User confirms swap
  -> choose canonical ERC-20 or Permit2 strategy
  -> read ERC-20 allowance
  -> submit exact ERC-20 approval when needed
  -> read Permit2 allowance when required
  -> submit exact Permit2 authorization when needed
  -> wait for receipts and re-read allowances
  -> report readiness to same-chain execution
```

## Responsibilities

Validate canonical quote approval metadata, bind it to the active chain,
token, spender, transaction target, and amount, then obtain readiness.

## Not here

Sponsored approvals, typed-data signatures, prepaid sponsorship, 0x gasless
submission, and Gas Assist UI belong to `src/features/gas-assist/` and the
Gas Assist hooks.

## Important files and exports

* `hooks/useSwapApproval.js`: `useSwapApproval`, `prepareSwapApproval`.
* `hooks/useSwapApproval.test.jsx`: mocked hook contract coverage.

## Data, dependencies, and side effects

Input is a normalized selected quote with canonical `approval` metadata,
connected wallet address, sell token, integer amount, and chain ID. The hook
returns readiness and the last approval result. It uses wagmi/viem to read
allowances, prompt paid transactions, wait for receipts, and emit existing
`approval.*` diagnostics.

## Errors and security

Malformed metadata, wrong chain/token/spender, unavailable wallet clients,
failed receipts, and insufficient allowances fail closed. Exact spender and
Permit2 expiry validation are security-critical.

## Testing and manual edits

`useSwapApproval.test.jsx` mocks Wagmi, Viem contract reads, and wallet
transactions. It does not prove wallet, RPC, Permit2, or provider behavior.
Edit strategy checks in the hook only after keeping quote-schema fields and
diagnostic event names stable.

## Known technical debt

ABI declarations are still local to the hook; extract them only with focused
tests so encoded calldata remains byte-for-byte unchanged.
