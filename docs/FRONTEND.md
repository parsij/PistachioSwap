# Frontend

`src/App.jsx` is the application composition boundary. It renders the app shell
and passes the page view model from
`src/features/swap/hooks/useSwapController.js` to
`src/features/swap/components/SwapPage.jsx`. Focused hooks own input, quote,
review, execution, receipt, Gas Assist, cross-chain, token, settings, and wallet
state.

The same-chain quote client is `src/features/swap/services/quotes.js`; paid
authorization is `src/features/approvals/hooks/useSwapApproval.js`. Gasless
behavior is owned by `src/features/gas-assist/hooks/useZeroXGaslessSwap.js` and
must not be imported by the normal approval feature. Cross-chain route state is
owned by `src/features/cross-chain/hooks/useCrossChainRoutes.js`.

Feature tests mock Wagmi, Viem, fetch, storage, and timers where applicable.
They validate orchestration contracts, not real wallet or provider behavior.
