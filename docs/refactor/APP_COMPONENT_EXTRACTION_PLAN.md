# App Component Extraction Plan

## Scope and invariants

This plan describes the dirty-worktree version of `src/App.jsx` at 4,269 lines before the application-shell extraction. The refactor may relocate frontend code but must preserve all visible copy, CSS classes, Radix portal behavior, accessibility labels, animations, quote timing, request identity, diagnostic event names, wallet calls, approval behavior, transaction behavior, Gas Assist behavior, and cross-chain behavior. No provider, wallet, or backend operation is needed to perform or test the moves.

The target dependency direction is `src/App.jsx -> src/app and src/features -> src/shared`. Pure model and service modules must not import React components. Feature code must not import `App.jsx`.

## Current file map

Line numbers refer to the pre-extraction 4,269-line file and are expected to drift as moves land.

| Lines | Current responsibility | State and refs | Hooks and callbacks | Rendered components | Proposed destination | Tests | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1-136 | Framework, wallet, feature, service, and configuration imports | None | React, AppKit, Wagmi | None | Imports distributed to owning hooks/components | All App tests | High: mocks rely on module identity |
| 137-304 | Same-chain and cross-chain structured diagnostics and safe error snapshots | None | Console logging only | None | `src/shared/logging/swapDiagnostics.js` and cross-chain model/service ownership | App wallet and execution tests | High: event names and safe payloads are contracts |
| 305-416 | Inline icons and info tooltip | Tooltip-local propagation callback | Radix Tooltip | Chevron, search, settings, direction, info | `src/shared/components/AppIcons.jsx`, `src/features/swap/components/SwapInfoTooltip.jsx` | `src/App.test.jsx` | Low: preserve SVG/ARIA and portal classes |
| 417-520 | Token identity and market-token normalization | None | Pure functions | None | `src/features/tokens/model/tokenNormalization.js` | Token selector and wallet-token tests | Medium: exact-address identity is security-sensitive |
| 521-610 | Token buttons and layout animation | None | Motion layout | `TokenIcon` | `src/features/swap/components/SwapTokenButton.jsx` | App tests | Medium: layout IDs must remain stable |
| 611-817 | Decimal conversion, comparison, quote amount formatting, and cost/rate formatting | None | Pure functions | None | `src/features/swap/model/amountMath.js`, `swapDisplay.js` | Quote, balance, and App tests | High: rounding behavior affects intent |
| 818-935 | Quick amount controls | Internal animation only | Motion | Percentage buttons | `src/features/swap/components/SwapQuickAmounts.jsx` | App wallet tests | Medium: native reserve and raw-unit callbacks |
| 936-1152 | Provider hooks, token catalog requests, wallet token requests, selector state, and native-token balance merge | `swapChainId`, `tokenSearch`, `selectorChainId`, `tokenSelectorSide`; no refs | AppKit/Wagmi, `useWalletState`, `useMarketTokens`, `useWalletTokens`, `useNativeBalance` | None | `src/features/tokens/hooks/useTokenCatalogController.js` plus app-level provider dependencies | Token selector, wallet-token, and App wallet tests | High: all-chain catalog fallback and selected-chain fetch rules |
| 1153-1370 | Token normalization/selection and swap input state | `activeTab`, selected tokens, sell/buy amounts, denominations, active side, quick-amount visibility, rotation | `useMemo`, classification diagnostic effect | None | `src/features/swap/hooks/useSwapInputs.js`, with catalog input supplied explicitly | App and wallet tests | High: switching and exact-input/output behavior |
| 1327-1404 | Same-chain quote and transaction UI state | quote/status/refresh/provider slippage/hash/transaction/status/details/review route state; quote and request refs | `useWaitForTransactionReceipt` | None | Quote fields to `useSwapQuote`; receipt fields to `useSameChainReceiptLifecycle`; cross-chain review state to cross-chain controller | Quote, execution, App wallet tests | High: stale responses and receipt once-only effects |
| 1405-1599 | Raw amount derivation, chain/routing mode, quote blocker, request snapshot/identity | No additional state | Gas Assist config, pure request construction, memoized snapshot | None | Amount derivation in `useSwapInputs`; routing model in `swapRouting.js`; snapshot in `useSwapQuote` | Quote and mode tests | High: request shape and identity must remain byte-compatible |
| 1600-1748 | Same-chain review plus cross-chain request/routing setup | Review hook state; cross-chain review ref/state | `useSameChainReview`, `useCrossChainRoutes`, cross-chain diagnostics | None | Review remains swap-owned; cross-chain setup moves to `useCrossChainController` | Review and cross-chain tests | High: authentication callback and stale route closure |
| 1749-1884 | Wallet refresh, normal approval/execution wiring, Gas Assist and prepaid sponsorship wiring | Existing feature-hook state | `useSwapApproval`, `useSameChainExecution`, `useZeroXGaslessSwap`, `usePrepaidSponsorship` | None | `useSameChainSwapLifecycle`, `useGasAssistController` | Approval, execution, Gas Assist, App wallet tests | High: wallet prompts and forced refresh ordering |
| 1885-2070 | Mode diagnostics and output synchronization effects | Mode/blocker diagnostic refs | Effects update buy amount/status | None | Quote diagnostics in `useSwapQuote`; mode effects in `useSwapController` or owning controller | App tests | Medium: visible status timing |
| 2071-2307 | Same-chain quote debounce, abort, validation, stale rejection, application, previous-quote retention | Quote refs and request refs | AbortController and timers | None | `src/features/swap/hooks/useSwapQuote.js` | Quote service and App tests | Critical: timing, caching, stale rejection, and event names |
| 2308-2370 | Wallet/chain transaction reset and same-chain receipt lifecycle | Transaction hash/status and review/amount/quote callbacks | Receipt effect | None | `src/features/swap/hooks/useSameChainReceiptLifecycle.js` | App wallet and focused receipt tests | High: success side effects must run once |
| 2371-2666 | Settings, token selector, amount editing, direction switch, denomination, selection callbacks | Input and selector state | Semantic event handlers | None | `useSwapInputs`, `useTokenSelectorState`, and catalog controller | App and token selector tests | High: quote invalidation boundaries |
| 2667-2906 | Funds/economic checks, review eligibility, primary action derivation and diagnostics | CTA diagnostic ref | Pure balance/action/eligibility models | None | `src/features/swap/model/swapEligibility.js`, `useSwapAction` | App wallet and review tests | High: disabled/visible CTA copy is a contract |
| 2907-3075 | Cross-chain review eligibility, preparation, cost estimation, submission | Cross-chain review route/error/preparation and request ref | Wallet resolution, route claim, approvals, send | None | `src/features/cross-chain/hooks/useCrossChainController.js` and `src/features/cross-chain/services/crossChainExecution.js` | Cross-chain service and App tests | Critical: chain/account binding and ordered steps |
| 3076-3260 | Primary CTA routing, same-chain review opening, same-chain confirmation delegation | Existing controller states | AppKit open/switch, feature callbacks | None | `src/features/swap/hooks/useSwapPrimaryAction.js` | App tests | High: route selection and visible errors |
| 3261-3345 | Cross-chain step transaction and authentication signing | Cross-chain route data | Wagmi config, wallet client, network switch | None | `useCrossChainExecution` | Cross-chain mocked tests | Critical: wallet and signature behavior |
| 3346-3482 | Presentation view-model derivation | None | Pure formatting | None | `useSwapViewModel` plus display model functions | App tests | Medium: labels and fee rows |
| 3483-3555 | Application header and passkey test panel | Receives wallet/token/settings data | Balance refresh callback | Header, wallet controls, passkey panel | `src/app/AppHeader.jsx` and existing `src/features/passkey/components/PasskeyVaultTestPanel.jsx` | App wallet and passkey tests | Medium: wallet modal entry points |
| 3556-3900 | Swap toolbar, sell/buy panels, amount fields, quick amounts, direction switch | Presentation-local hover/focus comes from input controller | Semantic callbacks | Settings popover and token buttons | `SwapPage`, `SwapCard`, `SwapTabs`, `SwapTokenPanel`, `SwapAmountInput`, `SwapQuickAmounts`, `SwapDirectionButton` | App and wallet tests | Medium: CSS and animation layout IDs |
| 3901-4035 | Primary action, quote details, cross-chain route cards, Gas Assist banner, status messages | Details-open state | Primary action callback | Details rows, routes, banner | `SwapDetails`, `SwapPrimaryAction`, `TransactionStatus`, feature-owned route/banner components | App, Gas Assist, cross-chain tests | Medium: exact labels and conditional rows |
| 4036-4094 | Token selector overlay | Selector state from token controller | Search/chain/select/close callbacks | `TokenSelector` | `src/features/tokens/components/TokenSelector.jsx` and `SwapPage` portal composition | Token selector tests | Medium: AnimatePresence and selection identity |
| 4095-4131 | Gas Assist and same-chain dialogs | Feature hook state | Confirm/close callbacks | Three dialogs | `src/features/gas-assist/components/GasAssistDialogs.jsx`, `SwapPage` | Gas Assist and review tests | High: wallet side effects only from callbacks |
| 4132-4265 | Cross-chain review Radix dialog | Cross-chain controller state | Submit/cancel callbacks | Radix portal and review rows | `src/features/cross-chain/components/CrossChainReviewDialog.jsx` | Cross-chain/App tests | High: portal, Escape, disabled state, costs |
| 4266-4269 | Wallet controller and shell close | External wallet controller | None | `PistachioWalletController` | `src/app/AppLayout.jsx` or `SwapPage` overlay slot | Wallet tests | Low |

## Major UI extraction contracts

### Application header

- **State used:** wallet state, native balance, wallet tokens, swap settings, selected tokens.
- **Callbacks:** refresh native and wallet-token balances.
- **Destination:** `src/app/AppHeader.jsx`.
- **Dependencies passed:** brand, navigation, copy, wallet view model.
- **Risk:** preserve the existing Pistachio and AppKit wallet entry points and accessibility labels.

### Swap tabs and settings

- **State used:** active tab and settings.
- **Callbacks:** select tab and apply settings.
- **Destination:** `SwapTabs.jsx` and `SwapToolbar.jsx`.
- **Risk:** low; the inactive tabs are currently presentation-only and must remain so.

### Sell and buy token panels

- **State used:** token, amount, denomination, balance, insufficient-funds flag, quick-amount visibility, rotation/layout identity.
- **Callbacks:** amount edit, token selector open, denomination toggle, max/percentage selection, direction switch.
- **Destination:** `SwapTokenPanel.jsx`, `SwapAmountInput.jsx`, `SwapTokenButton.jsx`, `SwapQuickAmounts.jsx`, `SwapDirectionButton.jsx`.
- **Risk:** high because raw/token/USD conversions and quote resets must remain in the input hook, not presentation.

### Quote details and primary CTA

- **State used:** active quote status, provider, costs, slippage, routing mode, action state, transaction state.
- **Callbacks:** toggle details, select cross-chain route/sort, perform primary action.
- **Destination:** `SwapDetails.jsx`, `SwapPrimaryAction.jsx`, `TransactionStatus.jsx`.
- **Risk:** medium; exact copy and route-specific rows are asserted by tests.

### Dialogs and overlays

- **State used:** token selector, same-chain review, Gas Assist dialogs, cross-chain review.
- **Callbacks:** semantic close/confirm/select callbacks.
- **Destination:** feature-owned components under swap, tokens, Gas Assist, and cross-chain.
- **Risk:** high; preserve portal mounting, Escape behavior, focus restoration, and diagnostic DOM refs.

## Controller extraction order

1. Move pure diagnostics, amount, token identity, and display functions so controllers share stable non-React dependencies.
2. Extract presentation-only components without moving their state.
3. Extract token catalog/selector state and swap input state, retaining semantic reset callbacks.
4. Extract the same-chain quote lifecycle with all four identity refs private to the hook.
5. Extract the receipt lifecycle with transaction hash/status ownership and once-only receipt side effects.
6. Extract Gas Assist orchestration and cross-chain orchestration into separate feature hooks.
7. Compose those focused hooks in `useSwapController`; expose grouped component props rather than a flat field list.
8. Reduce `src/App.jsx` to provider-level composition and render `AppLayout`/`SwapPage`.

## Coupled refs and stale-response risks

- `quoteRef`, `quoteLogicalKeyRef`, `currentSameChainRequestKeyRef`, and `lastStartedSameChainRequestRef` move together into `useSwapQuote`; splitting them would weaken stale-response rejection.
- `crossChainReviewRequestRef` moves with review preparation so delayed cost estimates cannot update a different route.
- `quoteModeDiagnosticRef`, `sameChainBlockerDiagnosticRef`, and `swapActionDiagnosticRef` remain private to their diagnostic-producing hook.
- Same-chain duplicate confirmation remains private to `useSameChainExecution`.
- Receipt once-only handling will use the current transaction status/hash pair and guarded effect semantics in `useSameChainReceiptLifecycle`.

## Test strategy

- Pure model/service moves: run their focused tests first.
- Input/token moves: run `src/App.test.jsx`, `src/App.wallet.test.jsx`, token selector, wallet-token, and market-token tests.
- Quote move: run quote service and App tests with mocked fetch/timers.
- Approval/execution/receipt move: run approval, same-chain execution, receipt, and App wallet tests.
- Gas Assist move: run the existing ZeroX Gasless and prepaid sponsorship tests.
- Cross-chain move: run cross-chain route/service/hook tests and App tests.
- Final shell/UI move: run all non-live frontend tests, lint, and one production build.

Mocks prove React orchestration and request construction only. They do not prove live Wagmi, Viem RPC, Permit2, PancakeSwap, Uniswap, 0x, Gas Assist sponsorship, cross-chain providers, wallet prompts, signatures, simulations, transactions, receipt propagation, CSS stacking, or browser layout.
