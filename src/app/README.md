# Application Shell

## Purpose

`src/app` owns application-wide composition primitives. `src/App.jsx` calls the swap controller and renders `AppLayout`, `AppHeader`, and `SwapPage`; `src/main.jsx` owns React mounting and provider/error-boundary placement.

## Responsibilities

- Provide the `main.app-shell` CSS-variable boundary.
- Render brand navigation and wallet entry points.
- Catch render errors before they replace the entire document.
- Keep application composition separate from swap, token, wallet, and provider algorithms.

## What does not belong here

Quote requests, token selection, approvals, Gas Assist, cross-chain execution, passkey vault mechanics, transaction submission, receipt polling, or feature-specific validation.

## Important files and exports

- `AppLayout.jsx`: default `AppLayout`, slot-based shell.
- `AppHeader.jsx`: default `AppHeader`, brand/navigation/wallet presentation.
- `AppErrorBoundary.jsx`: default class error boundary used by `src/main.jsx`.
- `AppArchitecture.test.js`: protects the 350-line shell limit and prevents a replacement mega-controller.

## Inputs and outputs

`AppLayout` accepts `style`, `header`, `children`, and optional `overlays` React nodes. `AppHeader` accepts configured brand/navigation/search labels and the exact props consumed by `WalletConnectionButton`.

## Dependencies and side effects

The shell depends on React and feature components. It performs no HTTP/RPC work. Wallet controls can open AppKit or account dialogs through their own callbacks. The error boundary writes an error diagnostic and renders its existing fallback.

## Errors, logging, and security

Feature errors should remain feature-owned. Do not place secrets or provider keys in shell props. The shell must not weaken account, chain, quote, approval, or transaction validation.

## Tests

`AppArchitecture.test.js` tests boundaries; `AppErrorBoundary.test.jsx` tests fallback behavior; `src/App.test.jsx` and `src/App.wallet.test.jsx` cover composed behavior using mocked browser/provider dependencies.

## Common manual edits

- Header branding/navigation: `AppHeader.jsx` plus `swapConfig.js`.
- Page wrapper: `AppLayout.jsx`.
- Provider order or root error handling: `src/main.jsx`.

## Known technical debt

AppKit provider composition remains in `src/web3/AppKitProvider.jsx`; moving it is independent of the App-size refactor.
