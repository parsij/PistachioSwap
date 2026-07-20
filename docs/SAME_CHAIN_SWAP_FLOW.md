# Same-Chain Swap Flow

1. `src/App.jsx` selects sell/buy tokens and records token-denominated or USD input.
2. Its existing debounce and stale-request guards build a request with
   `src/features/swap/services/quotes.js`.
3. The client posts to `POST /v1/quote`; cache, abort, force-refresh, identity,
   response normalization, and approval-schema checks remain in that service.
4. `apps/api/src/features/quotes/routes/quote-routes.ts` validates the request.
5. `services/quote-selector.ts` runs provider adapters, normalizes results, and
   applies the existing ranking.
6. The response is cached and applied only if current; the review dialog uses
   its existing quote snapshot guard.
7. `useSwapApproval` checks/requests direct ERC-20 or Permit2 authorization.
8. After an approval transaction the quote is force-refreshed.
9. `src/services/simulationError.js` performs the existing read-only simulation.
10. `src/services/swapTransaction.js` submits and the existing receipt monitor
    updates swap status.

Cross-chain and Gas Assist branch before paid same-chain approval.
