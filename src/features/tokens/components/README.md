# Token UI Components

# TokenSelector

## Purpose and location

`TokenSelector.jsx` is the portaled token discovery/selection surface for Sell and Buy. It is default-exported and rendered by `TokenSelectorOverlay` under `SwapPage`. It is stateful for section visibility, recent tokens, context menu, and keyboard/menu interaction; backend catalog state comes from `useTokenCatalogController`.

## Props

| Prop | Type | Required | Source / behavior |
| --- | --- | --- | --- |
| `side` | `sell` or `buy` | yes | Chooses labels and selection semantics. |
| `chainId` | number or `all` | yes | Current selector chain. |
| `tokens`, `commonTokens`, `walletTokens` | arrays | yes | Already normalized catalog groups. |
| `search` | string | yes | Controlled search value. |
| `loading`, `error`, `catalogNotice` | values | yes | Loading/empty/error/partial states. |
| `catalogDiagnostics` | object | yes | Development catalog counts/state. |
| `currentToken`, `oppositeToken` | token/null | yes | Active and collision-protected token identities. |
| `onSearchChange`, `onChainChange`, `onSelect`, `onClose` | functions | yes | Controlled semantic callbacks; selection may be async only through parent updates. |
| `hideUnknownTokens`, `hideSmallBalances` | booleans | yes | Settings-driven filtering. |

## Rendered states and side effects

Renders search, chain selection, recent/common/wallet/market/unverified sections, skeletons, notices, risk indicators, and a token context menu. It reads/writes recent tokens and section preferences in browser storage, may copy addresses, and may open token-detail URLs. It performs no quote, approval, RPC, signature, or transaction calls.

## Errors and debug checklist

1. Confirm `TokenSelectorOverlay.open` and portal mount.
2. Inspect controlled search/chain props.
3. Inspect catalog `loading/error/notice/diagnostics`.
4. Inspect visibility settings and section preferences.
5. Verify exact current/opposite identities.
6. Check browser storage access and context-menu state.
7. Run `pnpm vitest run src/features/tokens/components/TokenSelector.test.jsx`.

## Styling and accessibility

Primary stylesheet: `TokenSelector.css`. Preserve `ps-token-*` classes tested by focused tests. The dialog/menu uses labeled buttons, keyboard chain options, focus handling, and close controls. JSDOM does not prove viewport layout or z-index.

## Common manual changes and limitations

Edit row content and sections in this file; edit catalog data elsewhere. The file is a known oversized surface and should next split state/storage from row/body presentation without changing storage keys.

# TokenIcon

## Purpose

`TokenIcon.jsx` and `tokenLogoCache.js` render token/chain images with cached candidate fallback. They are presentation components consumed by swap, selector, wallet, and Gas Assist UI.

## Side effects, errors, accessibility, and tests

Image load failures update the local cache and try the next candidate; no network API is called directly beyond browser image loading. Decorative images retain existing alt/ARIA behavior. Tests cover cache/fallback semantics but not remote host availability or visual quality.

# TokenSelectorOverlay

## Purpose

`TokenSelectorOverlay.jsx` preserves the existing `AnimatePresence` boundary and conditionally renders `TokenSelector`. It owns no state and has no direct side effects beyond child mounting/unmounting.
