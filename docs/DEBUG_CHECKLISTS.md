# UI Debug Checklists

Commands below are offline/mocked unless a developer intentionally changes their environment. Do not use these checklists as proof of live provider or wallet behavior.

## UI element not rendering

1. Inspect `SwapPage` grouped props and the relevant component in `UI_COMPONENT_INDEX.md`.
2. Inspect `useSwapController` and the owning hook/view model branch.
3. Check conditional `open`, route, quote-status, or mode values.
4. Check existing CSS class and Motion/Radix `data-state`.
5. For dialogs, inspect portals under `document.body`.
6. Run `pnpm vitest run src/App.wallet.test.jsx` plus the focused component test.

## Button disabled unexpectedly / click not running

1. Component: `SwapPrimaryAction`; hook: `useSwapPrimaryAction`; model: `deriveSwapEligibility`.
2. Inspect action `{type,label,enabled}`, transaction status, funds/economic flags, and review eligibility.
3. Expect `cta.derived -> primary-action.clicked` for an enabled click.
4. Verify no overlay intercepts pointer/focus and native `disabled` is false.
5. Run `pnpm vitest run src/App.wallet.test.jsx`.

## Token selector not opening

1. Component: `SwapTokenPanel`/`TokenSelectorOverlay`; hook: `useTokenCatalogController`.
2. Inspect selector `side`, chain, search, and open callback.
3. Check portal/AnimatePresence and `ps-token-*` classes.
4. Check catalog request only after selector state changes; browser Network route is the configured market-token endpoint.
5. Run `pnpm vitest run src/features/tokens/components/TokenSelector.test.jsx`.

## Token selector search or sections wrong

1. Component: `TokenSelector`; hook: `useTokenSelectorState`; model: `tokenSelectorState.js`.
2. Inspect `chainScope`, normalized search, wallet identity map, visibility flags, and section arrays.
3. For an empty query expect wallet/recent/market/common sections; for an address query expect exact wallet/address matches plus market matches.
4. Check `TokenSelectorSections`, `TokenSearchResults`, and `TokenRow` props before inspecting catalog services.
5. Run `pnpm vitest run src/features/tokens/components/TokenSelector.test.jsx src/features/tokens/hooks/useTokenCatalogController.test.jsx`.

## Token selector focus or keyboard behavior wrong

1. Inspect `TokenSelector.jsx` dialog role, `autoFocus` search input, backdrop pointer handler, and hook Escape listener.
2. Check `ChainSelector` listbox `aria-expanded`, `role="option"`, and disabled unavailable chains.
3. Confirm body overflow is restored on unmount and context menu closes on Escape/resize/scroll.
4. Run the focused selector test; JSDOM does not prove actual focus rings, scrolling, or portal layout.

## Quote not loading

1. Component: amount panel/status; hook: `useSwapQuote`; service: `features/swap/services/quotes.js`.
2. Inspect raw controlled amount, account, wallet correct-network, chain/token addresses/decimals, routing mode, endpoint, and blocker.
3. Expect `quote.ready-to-schedule -> quote.request.scheduled -> quote.request.start -> quote.response.received -> quote.validation.passed -> quote.applied`.
4. Inspect browser `POST /v1/quote` request body and abort status.
5. Run `pnpm vitest run src/features/swap/services/quotes.test.js src/App.wallet.test.jsx`.

## Stale quote reused

1. Hook: `useSwapQuote`; validators: `sameChainReviewEligibility` and `refreshedQuoteValidation`.
2. Compare snapshot `inputKey/requestKey`, quote logical key, account, chain, tokens, exact mode, raw amount, slippage, expiry.
3. Expect obsolete response to log `quote.response.ignored` or `quote.error.ignored`.
4. Confirm only an unexpired quote with the same logical input is retained after refresh failure.
5. Run quote and App stale-response tests.

## Review swap not opening / dialog invisible

1. Component: `SwapPrimaryAction` then `SameChainReviewDialog`; hooks: primary action and `useSameChainReview`.
2. Inspect review eligibility/blocking message, quote expiry, request identity, transaction status.
3. Expect `review.eligibility.checked -> review.open.requested`.
4. Inspect Radix content under `document.body`, current `data-state`, content ref, CSS portal layer, and focus target.
5. Run App review/accessibility tests; JSDOM class assertions do not prove visual z-index.

## Approval prompt not appearing / ERC-20 allowance wrong

1. Component: review dialog; hooks: `useSameChainExecution` then `useSwapApproval`.
2. Inspect canonical metadata `{mode,contract,spender,token,requiredAmount}` and owner/account/chain.
3. Expect `review.confirm.clicked -> approval.prepare.start -> approval.erc20.read.start`; wallet prompt event appears only if insufficient.
4. Confirm RPC allowance is owner to exact spender, raw amount uses token decimals, and receipt/reread completes.
5. Run `pnpm vitest run src/features/approvals/hooks/useSwapApproval.test.jsx`.

## Permit2 allowance expired / spender mismatch

1. Hook: `useSwapApproval` and execution recovery; services: refreshed quote validator and simulation decoder.
2. Inspect tuple owner, token, Permit2 contract, router spender, amount, expiration, nonce, schema version.
3. Expect Permit2 read/renewal events; recovery sequence is invalidate -> refresh -> validate -> prepare -> optional second refresh -> simulate.
4. Verify `AllowanceExpired` came only from validated Pancake/Permit2 simulation and recovery attempt is at most one.
5. Run approval and `useSameChainExecution` tests.

## Simulation failure

1. Hook: `useSameChainExecution`; service: `simulationError.js` and executable validator.
2. Compare simulated `{account,chain,to,data,value}` to the later sender request.
3. Expect `simulation.start` followed by failure and no `transaction.send.start`.
4. Check deadline, allowance, balance, target, calldata, and decoded custom error.
5. Run execution and executable-transaction tests.

## Wallet transaction prompt missing

1. Component: review dialog; hook: execution; sender: Wagmi `sendTransaction` supplied by controller.
2. Confirm approval and simulation succeeded, duplicate guard is clear, account/chain remain captured values.
3. Expect `transaction.send.start`; absence means an earlier validation/simulation blocked.
4. Inspect wallet connector readiness separately; browser Network does not represent a wallet prompt.
5. Run App wallet and execution tests.

## Transaction submitted but not confirmed / receipt reverted

1. Component: `TransactionStatus`; hook: `useSameChainReceiptLifecycle`.
2. Inspect hash, chain ID, transaction status `submitted`, Wagmi receipt success/error.
3. Expect repeated `receipt.monitor.tick`, then exactly one `receipt.confirmed` or `receipt.failed`.
4. Check explorer/RPC for the hash before retrying; a reverted receipt may have spent gas.
5. Run `pnpm vitest run src/features/swap/hooks/useSameChainReceiptLifecycle.test.jsx`.

## Gas Assist appearing during a normal swap

1. Component: `GasAssistBanner`; hooks: `useSwapRouting` and `useGasAssistController`.
2. Inspect BSC/mixed-chain flags, native balance status/value, backend Gas Assist config, routing/execution modes.
3. Expect `quote.mode.selected` to identify same-chain versus Gas Assist.
4. Confirm normal `useSwapApproval` has no Gas Assist dependency.
5. Run Gas Assist hook tests and App normal-route fallback test.

## Cross-chain route not appearing

1. Component: `SwapDetails/CrossChainRouteCards`; hook: `useCrossChainController` then `useCrossChainRoutes`; service: cross-chain routes.
2. Inspect mixed chain IDs, exact-input side/raw amount, account/recipient, slippage, request/context key, route phase/error/expiry.
3. Expect route quote diagnostics and `[cross-chain-cost-estimate]` after selection.
4. Inspect configured cross-chain backend request, not provider secrets/browser fan-out.
5. Run cross-chain hook/service/card tests and App cross-chain tests.

## Settings popover or persistence is wrong

1. Component: `SwapSettingsPopover`; hooks: `useSwapSettingsPopover`, then `useSettingsDraft`; service: `services/swapSettings.js`.
2. Inspect `open`, `draftMode`, `customInput`, `customError`, persisted settings, and key `pistachioswap:swap-settings:v1`.
3. For a missing dialog, inspect Radix portal/content `data-state`, trigger props, `onOpenChange`, and focus refs.
4. For a rejected value, inspect `parseSlippageInput` and `aria-invalid`; expected messages are in `ERROR_CATALOG.md`.
5. For a toggle mismatch, inspect the full object passed to `onSettingsChange` and normalized storage output.
6. Existing settings diagnostics are unchanged; inspect quote identity diagnostics only after persistence succeeds.
7. Run `pnpm vitest run src/features/settings/components/SwapSettingsPopover.test.jsx src/features/settings/services/swapSettings.test.js`.
