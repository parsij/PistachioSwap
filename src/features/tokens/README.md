# Tokens Feature

## Purpose

Owns market and wallet token discovery, native-balance integration, exact token identity, selector state, search/visibility rules, logo presentation, and token selection UI.

## Responsibilities and files

- `hooks/useTokenCatalogController.js`: composes all-chain preload, selected-chain/search fallback, wallet tokens, native balance, selector state, and merged records.
- `hooks/useMarketTokens.js`, `useWalletTokens.js`, `useNativeBalance.js`: focused data lifecycles.
- `services/marketTokens.js`, `walletTokens.js`, `tokenPrices.js`, `portfolio.js`: request, normalization, merge, pricing, and formatting rules.
- `model/tokenNormalization.js`: exact chain/address identity and UI normalization.
- `components/TokenSelector.jsx`: 66-line dialog composition shell.
- `components/TokenSelectorSections.jsx`: recent, wallet, market, common, and search result markup.
- `components/TokenSelectorPrimitives.jsx`: chain selector, skeleton, headings, and token rows.
- `components/TokenSelectorIcons.jsx`: selector-local SVG icons.
- `hooks/useTokenSelectorState.js`: derived sections, search matching, recent storage, context actions, and lifecycle effects.
- `model/tokenSelectorState.js`: pure identity, sorting, normalization, and recent-storage functions.
- `components/TokenIcon.jsx`: resilient icon presentation.

## What does not belong here

Swap quote requests, approval/transaction logic, Gas Assist, cross-chain route execution, or wallet connector/vault mechanics.

## Public inputs and outputs

The catalog controller receives active chain, wallet state, and configured initial tokens. It returns `availableTokens`, `walletTokens`, `nativeBalance`, refresh operations, and a grouped selector API. Tokens retain backend classification/security fields plus normalized `id`, chain, address, decimals, logos, balance, and USD price.

## Side effects, errors, and logging

Hooks call existing backend market/wallet-token routes, read native balance through Wagmi, use timers/caches defined in their focused hooks, and emit `[wallet-classification-summary]` only in development. Partial/stale data remains usable with visible notices. Selector storage records recent tokens and section preferences.

## Flow

`active chain/account -> market preload + selected catalog + wallet tokens + native RPC balance -> exact identity merge -> useSwapInputs resolves selected tokens -> TokenSelectorOverlay -> TokenSelector -> useTokenSelectorState -> TokenSelectorSections/TokenRow -> onSelect`.

## Selector contract and flow

`TokenSelector` is controlled by `chainId`, catalog arrays, `search`, current/opposite tokens, and semantic callbacks. Search input emits the raw string through `onSearchChange`; chain changes clear search before calling `onChainChange`; selecting a row confirms risky tokens, persists a sanitized recent record when searching, then calls `onSelect(token)`. The hook returns section arrays, loading/error branches, context-menu actions, and visibility toggles. No selector component calls quote, RPC, wallet, approval, or transaction services.

Recent searches and risky/unverified expansion state are browser-storage side effects. The selector locks body scrolling while mounted, closes on Escape, restores the prior overflow value on cleanup, and keeps the existing dialog role, labels, focus autofocus, context-menu keyboard semantics, and CSS classes.

## Errors and debugging

Catalog `error` renders the existing search error message; an empty filtered result renders `No matching tokens`; unavailable market data renders the existing inline status. Clipboard and token-detail failures become the existing notice messages. Inspect `TokenSelector.jsx`, then `useTokenSelectorState.js`, then catalog services. Run `pnpm vitest run src/features/tokens/components/TokenSelector.test.jsx`. JSDOM verifies markup and callbacks, not visual scrolling, popup behavior, image layout, or live catalog completeness.

## Security

Never identify contracts by symbol alone. Preserve backend recognition, spam, visibility, and security classifications. Risky-token confirmation must remain in `tokenRisk.js`.

## Tests and mocked limitations

Focused tests live beside hooks/services/components. Fetch, browser storage, timers, and logos are mocked; they do not prove provider completeness, RPC truth, browser image layout, or token safety.

## Common manual edits and technical debt

Catalog scheduling: `useTokenCatalogController.js` and `useMarketTokens.js`; merge/format: services; selector state: `useTokenSelectorState.js`; selector markup: `TokenSelectorSections.jsx` and `TokenSelectorPrimitives.jsx`. Remaining debt is the broad catalog input contract and the pre-existing `TokenSelector.test.jsx` integration fixture; no replacement selector file exceeds 160 lines.
