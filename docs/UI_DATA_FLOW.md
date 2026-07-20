# UI Data Flow

## Normal quote flow

```text
User edits Sell amount
-> SwapAmountInput emits onSellAmountChange(event)
-> useSwapInputs validates editable decimal and derives raw activeAmountIn
-> useSwapController supplies normalized account/chain/token/slippage intent
-> useSwapQuote builds request snapshot and request/logical identities
-> debounce + AbortController
-> fetchSwapQuote -> POST /v1/quote
-> backend validation/providers/ranking
-> normalizeQuoteResponse + approval schema validation
-> stale request-key check
-> quote state/cache + displayed Buy amount
-> createSwapViewModel
-> SwapDetails + SwapPrimaryAction
```

## Token selector flow

```text
SwapTokenPanel
-> TokenSelectorOverlay
-> TokenSelector controlled props
-> useTokenSelectorState
-> exact chain/address filtering + search ranking + storage-backed sections
-> TokenSearchResults or TokenSelectorSections
-> TokenRow
-> risky-token confirmation
-> onSelect(token)
-> useSwapInputs selected-token callback
```

The selector input is the raw search string. The hook owns normalized search,
wallet/market/common/recent arrays, hidden/unverified expansion, context-menu
notice state, and localStorage effects. Rows emit the canonical token object;
they do not fetch data or perform wallet calls. `TokenSelector.test.jsx` mocks
browser storage, clipboard, token-detail lookup, and catalog props; it does not
prove live catalog requests, scrolling, image layout, or popup behavior.

Boundary objects: input hook outputs tokens, display amounts, raw integer amounts, active side, denominations, and prices. Quote snapshot contains `inputKey`, request, `requestKey`, exact mode, refresh index, slippage, and decimals. Errors map to retained-previous or no-route visible status. Diagnostics remain `input.amount.changed`, `quote.*`, `approval.metadata.active-quote`, and `cta.derived`.

## Review flow

```text
SwapPrimaryAction
-> useSwapPrimaryAction rechecks action/review eligibility and expiry
-> useSameChainReview captures request key + selected quote + confirmed intent
-> SameChainReviewDialog portal
-> user confirms
-> useSameChainExecution validates captured intent
```

Review opening performs no allowance read, RPC simulation, wallet prompt, or submission. Blocking errors come from `deriveSameChainReviewEligibility`. Review state owns open/error/operation/content and trigger refs; execution owns the duplicate guard.

## Direct ERC-20 approval

```text
Confirm
-> useSameChainExecution
-> useSwapApproval.prepareSwapApproval
-> validate canonical approval metadata
-> read token allowance(owner, exact spender)
-> request approve only when insufficient
-> wait for receipt
-> reread allowance
-> return readiness + approval-submitted result
```

Account/chain/token/spender/amount are explicit inputs. Approval errors remain visible in review. Events use existing `approval.erc20.*` and `approval.prepare.*` names.

## Permit2 approval

```text
Confirm
-> validate Permit2 contract + router spender + token + required amount
-> read ERC-20 allowance owner -> Permit2
-> approve Permit2 contract if required
-> read Permit2 allowance owner/token/spender tuple
-> renew Permit2 amount/expiration if required
-> wait receipts and reread
-> return readiness
```

The tuple and expiration policy are security contracts. One simulation-time `AllowanceExpired` on validated Pancake/Permit2 execution may invalidate readiness, refresh, prepare once more, refresh again if approval elapsed, and simulate once more. It never loops.

## Transaction submission

```text
validated review intent
-> prepare approval
-> force refresh after approval when required
-> validateRefreshedQuote
-> getValidatedExecutableTransaction
-> runReadOnlySwapSimulation(publicClient, exact transaction)
-> sendTransaction(account, chain, to, data, value)
-> transaction hash/status stored by receipt hook
```

Failed simulation blocks the wallet sender. Refreshed account/chain/token/mode/amount/settings/provider/approval/target/schema/expiry mismatch fails closed. Events remain `quote.refresh.*`, `simulation.*`, and `transaction.send.*`.

## Receipt monitoring

```text
submitted hash
-> useSameChainReceiptLifecycle
-> useWaitForTransactionReceipt
-> receipt.monitor.tick
-> success: confirmed + close review + reset inputs + invalidate quote + refresh balances
-> failure: failed + visible review/status error
```

Hash/status are hook-owned. The submitted-status guard makes terminal side effects once-only. Tests mock Wagmi and do not prove RPC finality.

## Gas Assist

```text
useSwapRouting selects Gas Assist-eligible mode
-> useGasAssistConfig
-> useGasAssistController
-> useZeroXGaslessSwap quote
-> GasAssistBanner / GasAssistApprovalDialog
-> optional ONCHAIN_APPROVAL_REQUIRED -> usePrepaidSponsorship
-> explicit gasless signature/sponsorship confirmation
-> confirmed callback refreshes balances
```

Normal same-chain approval never imports a Gas Assist hook. Errors and side effects remain feature-owned. Tests mock 0x, sponsor, wallet, and signatures.

## Cross-chain flow

```text
mixed-chain exact-input intent
-> useCrossChainController creates request identity
-> useCrossChainRoutes debounce/backend request
-> normalized routes + current executable route
-> SwapDetails/CrossChainRouteCards
-> open review -> prepare route -> estimate source gas
-> CrossChainReviewDialog
-> confirm -> resolve/switch wallet
-> ordered approvals -> claim source -> source transaction -> mark submitted
```

Exact-output is visibly unsupported. Route/account/chains/assets/amount/expiry and prepared steps are revalidated. Diagnostics use `[cross-chain-execution]`, its error variant, and cost estimates.

## Settings flow

```text
SwapToolbar
-> SwapSettingsPopover
-> useSwapSettingsPopover
-> useSettingsDraft
-> SlippageSettingsSection / SettingsVisibilitySection
-> onSettingsChange
-> useSwapSettings
-> swapSettings.js normalization + localStorage
-> useSwapController effective settings
-> useSwapQuote request identity
```

The persisted settings object remains authoritative. The draft hook owns only
temporary slippage text/mode/error and synchronizes from persisted values while
the popover is closed. Valid custom slippage continues to persist immediately;
closing an invalid or empty custom field falls back to Auto. Presentation
components never access storage or quote services.
