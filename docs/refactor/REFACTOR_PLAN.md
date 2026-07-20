# PistachioSwap Refactor Plan

## Scope and invariants

This is a behavior-preserving organization refactor. The public HTTP routes,
request and response JSON, approval schema version, provider ranking, logging
event names, wallet prompts, transaction sequence, CSS selectors, accessibility
labels, and environment-variable names are contracts. No provider, wallet, or
transaction operation is run as part of this work.

## Current important tree

```text
src/
  App.jsx                              # swap orchestration and most UI
  components/{gas-assist,cross-chain,pistachio,settings,wallet}/
  hooks/{useGasAssistApproval,useZeroXGaslessSwap,useCrossChainRoutes}.js
  services/{quotes,gasAssist,crossChainRoutes,crossChainExecution}.js
  wallet/pistachio/
  web3/
apps/api/src/
  modules/quotes.ts                    # /v1/quote and /v1/swap/build
  providers/quotes/                    # selector, adapters, contracts
  gas-assist/
  cross-chain/
```

## Proposed important tree

```text
src/
  app/                                 # root composition and boundary
  features/
    approvals/{abi,hooks,services}/    # ordinary paid token authorization
    swap/{components,services}/        # same-chain quote client and UI primitives
    gas-assist/{components,hooks,services}/
    cross-chain/{components,hooks,services}/
    tokens/{components,hooks,services}/
    wallet/{components,hooks,services}/
  shared/{components,web3,styles}/
apps/api/src/features/quotes/
  routes/                              # stable HTTP route registration
  providers/                           # PancakeSwap, Uniswap, 0x adapters
  schemas/                             # request and normalized response validation
  types/                               # quote contracts
```

Only directories containing source are created. Existing feature families are
moved incrementally; unrelated dirty work remains in place.

## Path moves

| Old path | New path |
| --- | --- |
| `src/hooks/useGasAssistApproval.js` | `src/features/approvals/hooks/useSwapApproval.js` |
| `src/hooks/useGasAssistApproval.test.jsx` | `src/features/approvals/hooks/useSwapApproval.test.jsx` |
| `src/services/quotes.js` | `src/features/swap/services/quotes.js` |
| `src/services/quotes.test.js` | `src/features/swap/services/quotes.test.js` |
| `apps/api/src/modules/quotes.ts` | `apps/api/src/features/quotes/routes/quote-routes.ts` |
| `apps/api/src/providers/quotes/*` | `apps/api/src/features/quotes/{providers,schemas,types}/*` |

## Function renames

| Old name | New name | Contract |
| --- | --- | --- |
| `useGasAssistApproval` | `useSwapApproval` | Normal same-chain paid approval hook |
| `prepareApproval` | `prepareSwapApproval` | Performs existing approval readiness sequence |
| `quoteRoutes` | `sameChainQuoteRoutes` | Registers unchanged `/v1/quote` and `/v1/swap/build` routes |

## Oversized and misleading files

* `src/App.jsx` (4,873 lines) mixes rendering, selection, quote lifecycle,
  confirmation, approval, simulation, receipt monitoring, Gas Assist, and
  cross-chain routing.
* `src/hooks/useGasAssistApproval.js` is misleading: its live transaction
  flow is ordinary paid ERC-20/Permit2 authorization.
* `apps/api/src/providers/quotes/quote-selector.ts` combines concurrent
  provider execution, diagnostics, and ranking.

## Duplicated responsibilities and target ownership

* Quote state currently spans React state, refs, snapshots, and review state.
  `features/swap` owns request, normalization, identity, cache, and expiry;
  review snapshots remain adjacent to confirmation until they can be extracted
  without changing stale-response guards.
* Normal ERC-20 and Permit2 authorization belongs to `features/approvals`.
  Gas Assist owns only sponsored/gasless/prepaid behavior.
* Backend quote normalization, provider selection, and provider adapters belong
  under the one `features/quotes` contract family.

## Public contracts that must remain stable

* `POST /v1/quote`, `POST /v1/swap/build`, all other API routes, schemas, and
  diagnostic event names.
* `approvalSchemaVersion` and canonical approval fields: `mode`, `contract`,
  `spender`, `token`, `requiredAmount`.
* ERC-20 and Permit2 exact spender binding, expiration policy, quote refresh,
  simulation-before-submit, and duplicate-confirmation protection.
* Native BNB/WBNB handling, PancakeSwap/Uniswap/0x ranking, passkey wallet,
  cross-chain routing, UI appearance, labels, and environment names.

## Dependency and circular-import risks

* Frontend feature code must not import `App.jsx`; `App.jsx` composes feature
  hooks and components only.
* The quote route imports schemas, selector, and intents; provider adapters
  import contracts but never HTTP routes.
* Normal approval code depends on wagmi/viem and quote metadata but must not
  import Gas Assist hooks or services.
* NodeNext backend imports retain `.js` source suffixes after every move.

## High-risk files

`src/App.jsx`, `src/App.wallet.test.jsx`, `src/features/approvals/hooks/useSwapApproval.js`,
`apps/api/src/features/quotes/routes/quote-routes.ts`, and all provider adapters.

## Safe move order

1. Move normal approval hook and its focused tests; update callers/mocks.
2. Move frontend quote client and its focused tests; update callers.
3. Move backend quote contracts, adapters, selector, and route as one import
   graph; retain HTTP paths.
4. Add feature documentation and root architecture documentation.
5. Extract only verified cohesive `App.jsx` helpers/components in follow-up
   moves, retaining review snapshot and confirmation guards together.

## Tests affected

| Move | Focused tests |
| --- | --- |
| Normal approvals | `useSwapApproval.test.jsx`, `App.wallet.test.jsx` |
| Frontend quote client | `quotes.test.js`, `App.test.jsx`, `App.wallet.test.jsx` |
| Backend quotes | `apps/api/test/quotes.test.ts` |
| Route registration | `apps/api/test/quotes.test.ts` and non-live API tests |

## Known unrelated technical debt

The existing checkout has broad uncommitted changes across market catalog,
cross-chain, wallet, and API layers. Those changes are preserved. Mocked
wallet/provider tests validate contracts and orchestration only; they do not
prove a live wallet, RPC, Permit2, PancakeSwap, Uniswap, or 0x interaction.
