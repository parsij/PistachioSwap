# Swap Components

These components preserve the existing CSS classes, visible labels, Motion layout IDs, Radix behavior, and semantic callback boundaries. They perform no quote HTTP, RPC, approval, simulation, signature, or transaction work directly.

# SwapPage

## Purpose

Top-level swap feature composition displayed below the application header. It renders the toolbar/card and feature-owned overlays.

## Location and ownership

- Source: `src/features/swap/components/SwapPage.jsx`
- Export: default
- Parent: `src/App.jsx` through `AppLayout`
- Children: `SwapToolbar`, `SwapCard`, `TokenSelectorOverlay`, `SameChainReviewDialog`, `GasAssistDialogs`, `CrossChainReviewDialog`, passkey diagnostics, and wallet controller.

## Props

| Prop | Type | Required | Source | Behavior / side effects |
| --- | --- | --- | --- | --- |
| `toolbar` | object | yes | `createSwapViewModel` | Passed to `SwapToolbar`; callbacks may update settings/tab state. |
| `card` | object | yes | `createSwapViewModel` | Passed to `SwapCard`; semantic callbacks reach the controller. |
| `tokenSelector` | object | yes | token catalog controller | Controls selector overlay and selection callbacks. |
| `sameChainReview` | object | yes | review/execution hooks | Controls Radix review and confirmation. |
| `gasAssistDialogs` | object | yes | Gas Assist controller | Child confirmation may request signatures/transactions. |
| `crossChainReview` | object | yes | cross-chain controller | Child confirmation may submit prepared route steps. |

## Rendered states, state, and refs

The component owns no state or refs. Conditional rendering is delegated to overlay components through `open`, route, or dialog state. `SameChainReviewDialog` receives the diagnostic content ref and trigger focus is retained by the review hook.

## Errors and debug checklist

Errors render through `TransactionStatus` or feature dialogs. Debug in order: confirm `SwapPage` mounted; inspect grouped props; inspect `useSwapController`; check the owning feature hook; inspect diagnostic events; check portal nodes under `document.body`; run `pnpm vitest run src/App.wallet.test.jsx`.

## Styling and accessibility

Layout classes remain in `src/index.css` and feature CSS files. Page composition introduces no wrapper card or z-index. Accessibility is owned by its children.

## Tests and limitations

Covered through `src/App.wallet.test.jsx` and `src/app/AppArchitecture.test.js`. JSDOM does not prove layout, z-index, animations, wallets, RPC, or blockchain execution.

# SwapCard

## Purpose and signature

`SwapCard.jsx` composes sell/buy panels, direction button, primary CTA, details, optional Gas Assist banner, and statuses. It is default-exported, presentation-only, and used by `SwapPage`.

## Props

| Prop | Type | Required | Use |
| --- | --- | --- | --- |
| `sellPanel` / `buyPanel` | object | yes | Spread into `SwapTokenPanel`. |
| `direction` | object | yes | Spread into `SwapDirectionButton`. |
| `primaryAction` | object | yes | Spread into `SwapPrimaryAction`. |
| `details` | object | yes | Spread into `SwapDetails`. |
| `gasAssistBanner` | object or null | yes | Renders existing Gas Assist notice only when active. |
| `status` | object | yes | Rendered by `TransactionStatus`. |

## Rendered output and side effects

Uses the existing `LayoutGroup id="swap-layout"` and `swap-panels` classes. It owns no state. Child callbacks may update inputs or begin explicit workflows.

## Debug, styling, accessibility, tests

Inspect panel/action/detail view models first, then `swapViewModel.js`. Layout and animation are controlled by `src/index.css`, Motion props, and configuration tokens. Focus/labels are child-owned. App wallet tests cover visible composition.

# SwapTokenPanel and SwapAmountInput

## Purpose

`SwapTokenPanel.jsx` renders one Sell/Buy surface; `SwapAmountInput.jsx` renders its token/USD input. State and conversion logic belong to `useSwapInputs`.

## Props

| Prop | Type | Required | Valid values / source | Side effects |
| --- | --- | --- | --- | --- |
| `side` | string | yes | `sell` or `buy` | Chooses existing classes/labels. |
| `token` | object or null | yes | input hook | None. |
| `chainId` | number | yes | routing hook | Stable layout/token identity. |
| `amount` | object | yes | input view model | `onChange` emits browser event. |
| `secondaryValue` | string | yes | input hook | Display only. |
| `layoutIdentity` | string | yes | exact token identity | Motion layout ID. |
| `onOpenTokenSelector` | function | yes | controller | Opens selector; no network call in component. |
| `onToggleDenomination` | function | yes | input hook | Updates local input state. |
| `quickAmounts` / `balance` | object | sell only | controller | May fill amount or refresh mocked/backend balances. |
| `invalid` / `loading` | boolean | optional | eligibility/route state | Controls existing error/loading UI. |

## Rendered states and accessibility

Sell renders quick controls, maximum balance, and wallet-balance notices. Buy renders the cross-chain loading indicator. Inputs retain `inputMode="decimal"`, dynamic accessible labels, invalid state, and CSS classes.

## Errors and debug checklist

For wrong values: inspect component props; inspect raw/display values in `useSwapInputs`; verify token decimals/prices; inspect quote application; run App wallet tests. Wallet-balance notices originate in token hooks. Components have no wallet/provider errors of their own.

## Styling and tests

Primary styles: `src/index.css`; token UI also uses token selector CSS. Motion configuration comes from `swapConfig.js`. App wallet tests cover denomination, exact amounts, maximum balance, loading, and insufficient-funds states.

# SwapPrimaryAction

## Purpose

Renders exactly one primary CTA. `useSwapPrimaryAction` derives/routs behavior; the component only calls `onAction`.

## Props

| Prop | Type | Required | Behavior |
| --- | --- | --- | --- |
| `action` | `{type,label,enabled}` | yes | Controls copy, disabled state, and classes. |
| `reducedMotion` | boolean | yes | Disables press animation. |
| `triggerRef` | ref | yes | Same-chain focus restoration target. |
| `onAction` | async-capable function | yes | Called once per click; errors are handled by controller. |

## Rendered states, errors, and accessibility

Disabled and insufficient-funds states preserve existing classes. The native button supplies keyboard/disabled semantics. Visible action errors render in `TransactionStatus` or review dialogs.

## Debug checklist and tests

Inspect `action`; inspect `deriveSwapEligibility`; inspect `useSwapPrimaryAction`; verify `primary-action.clicked` and routing diagnostics; run App wallet tests. Disabled rendering alone is not duplicate protection; execution hook owns the synchronous guard.

# SwapDetails and SwapInfoTooltip

## Purpose

Renders the quote disclosure, same-chain fee/network rows, cross-chain normalized cost rows/routes, slippage/provider, minimum received, arrival, and exact-output maximum.

## State, side effects, styling, and accessibility

Open state is controller-owned. Route sort/selection callbacks are semantic. Tooltips use Radix portals under `document.body`, stop trigger propagation, and preserve accessible labels. CSS classes remain `swap-compact-details`, `swap-info-*`, and route classes.

## Errors and tests

Unavailable values render the existing labels. Inspect `swapViewModel.js`, normalized route costs, active quote, and route selection. App structure/wallet and cross-chain route-card tests cover output. JSDOM cannot prove tooltip stacking.

# SwapDirectionButton and SwapQuickAmounts

## Purpose and callbacks

The direction button emits `onSwitchTokens`; quick amounts emit a decimal token amount through `onSelect`. Both use Motion and reduced-motion configuration, with no network/wallet side effects.

## Debug, styling, accessibility, tests

Inspect rotation/visibility/spendable amount props, then input state and balance helpers. Preserve `switch-button`, `quick-amount-*`, and the direction button's accessible label. App wallet tests cover switching and exact balance fills.

# TransactionStatus

## Purpose

Displays native-balance verification failure, Gas Assist execution guidance, or the current shared status message. It owns no status state.

## Accessibility and tests

Messages retain `role="status"`; the shared message uses `aria-live="polite"`. Inspect receipt/Gas Assist/cross-chain hook state and diagnostic events before presentation. Covered by App wallet tests.

# SameChainReviewDialog

## Purpose, state, and refs

The existing `SameChainReviewDialog.jsx` is a presentation-only Radix review portal. `useSameChainReview` owns open/error/operation state, captured quote/intent, content/trigger refs, pending close protection, and focus restoration. `useSameChainExecution` owns confirmation.

## Props and callbacks

It receives open/change/content ref, reduced motion, token/amount summary, provider/slippage/details, error, confirm disabled/label, and async `onConfirm`. Cancel/Escape call the existing open-state callback; pending confirmation prevents unsafe closure.

## Errors, styling, accessibility, and tests

Review errors originate from eligibility, approval, refreshed quote, simulation, wallet submission, or receipt failure. Inspect `review.*`, `approval.*`, `quote.refresh.*`, `simulation.*`, `transaction.send.*`, and `receipt.*` events. Preserve current classes/labels/portal. Focus and portal behavior are covered by App tests, but JSDOM does not prove stacking or real wallet behavior.
