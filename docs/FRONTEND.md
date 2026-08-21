# Frontend

`src/App.jsx` is the application composition boundary. It renders the app shell
and passes the page view model from
`src/features/swap/hooks/useSwapController.js` to
`src/features/swap/components/SwapPage.jsx`. Focused hooks own input, quote,
review, execution, receipt, Gas Assist, cross-chain, token, settings, and wallet
state. AppKit and Wagmi load only after Connect wallet, through
`src/web3/walletRuntime.js`. `/landing/` stays static HTML so crawlers never
download the wallet bundle.

The same-chain quote client is `src/features/swap/services/quotes.js`; paid
authorization is `src/features/approvals/hooks/useSwapApproval.js`. Gasless
behavior is owned by `src/features/gas-assist/hooks/useZeroXGaslessSwap.js` and
must not be imported by the normal approval feature. Cross-chain route state is
owned by `src/features/cross-chain/hooks/useCrossChainRoutes.js`.

Feature tests mock `#wallet-runtime`, Viem, fetch, storage, and timers where applicable.
They validate orchestration contracts, not real wallet or provider behavior.
