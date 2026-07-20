# File Map

| Concern | Canonical path |
| --- | --- |
| App composition | `src/App.jsx` |
| Swap page controller | `src/features/swap/hooks/useSwapController.js` |
| Swap page presentation | `src/features/swap/components/SwapPage.jsx` |
| Same-chain quote client | `src/features/swap/services/quotes.js` |
| Paid ERC-20/Permit2 approval | `src/features/approvals/hooks/useSwapApproval.js` |
| Gasless/Gas Assist browser flow | `src/features/gas-assist/hooks/useZeroXGaslessSwap.js` |
| Cross-chain browser flow | `src/features/cross-chain/hooks/useCrossChainRoutes.js` |
| Quote HTTP endpoints | `apps/api/src/features/quotes/routes/quote-routes.ts` |
| Quote selection/ranking | `apps/api/src/features/quotes/services/quote-selector.ts` |
| Quote provider adapters | `apps/api/src/features/quotes/providers/` |
| Quote schemas/contracts | `apps/api/src/features/quotes/{schemas,types}/` |
| Gas Assist API | `apps/api/src/modules/gas-assist.ts` and `apps/api/src/gas-assist/` |
