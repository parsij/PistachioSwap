# Testing

Focused frontend tests: `src/features/approvals/hooks/useSwapApproval.test.jsx`
and `src/features/swap/services/quotes.test.js`. Backend API/provider contract
coverage: `apps/api/test/quotes.test.ts`. Broader integration tests remain in
`src/App.test.jsx` and `src/App.wallet.test.jsx`.

Tests commonly mock Wagmi, Viem, RPC, Permit2 contract reads, provider fetch,
browser storage, and timers. They are mocked integration tests, not evidence of
live wallet, signature, approval, transaction, PancakeSwap, Uniswap, or 0x
behavior. Browser tests are under `tests/playwright/` and are separate from
live integration tests.
