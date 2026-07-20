# Cross-Chain Components

## CrossChainRouteCards

Presentation component rendered inside `SwapDetails` when multiple routes exist. Props: route array, sort value/callback, select callback, recommended ID, selected ID. It sorts with the service, renders the existing preference controls/cards, and emits semantic callbacks. No HTTP/wallet work. Preserve route classes, accessible section/sort labels, and selection state. Test: `CrossChainRouteCards.test.jsx`.

## CrossChainReviewDialog

Portaled Radix confirmation dialog rendered by `SwapPage`. Props include `open`, prepared `route`, reduced motion, amount side/tokens, normalized cost labels, preparation state, route/execution errors, disabled state, and close/confirm callbacks. It owns no route state. Confirm may be async and may trigger wallet work through the controller; thrown errors are handled there.

Rendered states: preparing estimate, ready, estimate unavailable, insufficient native gas, route error, execution error, disabled/confirm/cancel, route expiry/cost/chain/provider/arrival/minimum details. It preserves `cross-chain-review-*` classes, `Close review`, Escape/portal/focus behavior, and status roles.

Debug checklist: confirm route is non-null; inspect preparation and `confirmDisabled`; inspect controller route identity/expiry; inspect `[cross-chain-*]` diagnostics; check portal under `document.body`; run route/controller/App tests. JSDOM does not prove stacking, wallets, network switching, gas, or settlement.

## ChainSelector

Presentation selector for supported curated chains. It receives current chain/options/callbacks and must preserve curated-chain identity. It performs no provider call itself.
