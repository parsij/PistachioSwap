# Error Catalog

The table records errors/messages that exist in the current frontend. “Funds” describes direct risk from the failed operation; validation failures prevent submission and therefore do not themselves move funds.

## UI validation

| Error / visible message | Origin | Trigger | Recovery | Logs / funds |
| --- | --- | --- | --- | --- |
| `Select a token`, enter amount, connect/switch states | `services/swapAction.js`, `swapEligibility.js` | Incomplete intent/wallet | Complete required input | `cta.derived`; no funds |
| `Not enough <symbol>` | `swapEligibility.js` | Raw required sell exceeds spendable balance | Reduce amount/fund wallet | CTA diagnostic; no submission |
| `Estimated costs are too high for this amount.` | `swapEligibility.js` | Known cost exceeds output | Increase amount/change route | CTA diagnostic; no submission |
| `USD input is unavailable for this token.` | `useSwapInputs.js` | Missing trusted/display price | Use token denomination | `input.denomination.blocked`; no funds |
| `Exact output is not supported for this route.` | cross-chain controller/eligibility | Buy side drives cross-chain | Use exact input | CTA/status; no submission |

## Quote request and provider response

| Error / visible message | Origin | Trigger | Recovery | Logs / funds |
| --- | --- | --- | --- | --- |
| `Quote response did not contain a valid amount` | `useSwapQuote.js` | Missing/invalid normalized amount | Retry/change intent | `quote.validation.failed`; no funds |
| `No route is currently available.` | `useSwapQuote.js` | All same-chain providers fail outside DEV | Retry/change amount/tokens | `quote.error.visible`; no funds |
| `Price refresh failed. Showing the previous quote.` | `useSwapQuote.js` | Refresh fails while same logical unexpired quote exists | Retry; review expiry still enforced | `quote.error.retained-previous`; no automatic submission |
| Provider timeout/legal restriction/integrator fee mismatch | backend quote feature, surfaced through quote client | Provider timeout/restriction/fee validation | Try another route/amount; developer checks backend diagnostics | Frontend quote error plus backend provider events; no funds |

## Approval metadata and quote refresh

| Error / visible message | Origin | Trigger | Recovery | Logs / funds |
| --- | --- | --- | --- | --- |
| Incomplete/malformed approval metadata | `sameChainReviewEligibility.js`, `refreshedQuoteValidation.js`, approval hook | Missing mode/contract/spender/token/amount/schema | Fresh quote; inspect provider normalization | `approval.metadata.*`; submission blocked |
| Mismatched refreshed quote / confirmed intent | `RefreshedQuoteValidationError` in `refreshedQuoteValidation.js` | Account, chain, token, mode, raw amount, slippage, provider, approval, target, schema, or expiry changed | Close/reopen review with fresh quote | `quote.refresh.*`, execution failure; no funds |
| Stale quote | quote hook/review validator | Request key changed or expiry passed | Automatic/manual refresh | `quote.response.ignored`, `review.blocked`; no funds |
| Wrong account / wrong chain | refreshed/executable validators and approval hook | Wallet differs from captured intent | Switch back/reopen review | validation diagnostics; no funds |

## ERC-20 approval

| Error / visible message | Origin | Trigger | Recovery | Logs / funds |
| --- | --- | --- | --- | --- |
| `InsufficientAllowance` or allowance still insufficient | `useSwapApproval.js` | Read/reread below required amount | Retry approval/check receipt/RPC | `approval.erc20.*`; approval may already exist, swap not sent |
| Approval wallet rejection | approval hook / user rejection mapping | User rejects prompt | Retry from review | wallet/approval events; no new approval |
| Approval receipt failure | approval hook | Approval reverts/fails confirmation | Check explorer/balance/token | approval receipt events; gas may be spent |

## Permit2 approval

| Error / visible message | Origin | Trigger | Recovery | Logs / funds |
| --- | --- | --- | --- | --- |
| `AllowanceExpired` | simulation decoder/execution hook | Validated Pancake Permit2 authorization expired | One automatic invalidate/refresh/reapprove/resimulate attempt | `approval.permit2.recovery.*`; gas may be spent on approval only |
| Permit2 spender/token/contract mismatch | approval/refreshed validators | Canonical tuple differs | Fresh quote; inspect provider metadata | approval metadata events; fail closed |
| Permit2 expiration/amount insufficient | approval hook | Tuple allowance not ready | Renewal prompt then receipt/reread | `approval.permit2.*`; gas may be spent on authorization |

## Simulation and executable transaction

| Error / visible message | Origin | Trigger | Recovery | Logs / funds |
| --- | --- | --- | --- | --- |
| Malformed executable transaction | `getValidatedExecutableTransaction` | Missing/invalid target, calldata, value/gas, chain/token/account, expiry | Fresh quote; inspect provider output | validation/execution diagnostics; send blocked |
| `TransactionDeadlinePassed` | `simulationError.js` | Calldata deadline expired | Refresh quote | `simulation.*`; send blocked |
| Simulation failure | `runReadOnlySwapSimulation` / execution hook | Read-only call reverts or cannot prove success | Inspect decoded error, allowance, balance, chain; refresh | `simulation.start/failed`; send blocked |

## Wallet rejection and transaction submission

| Error / visible message | Origin | Trigger | Recovery | Logs / funds |
| --- | --- | --- | --- | --- |
| Current wallet rejection message | `useSameChainExecution.js`, `swapTransaction.js` | User rejects send | Retry confirmation | `transaction.send.failed`; no swap sent |
| `A swap is already being processed.` | primary action/execution guard | Repeated action while pending/submitted | Wait for current lifecycle | `primary-action.blocked`; duplicate prevented |
| Wallet/provider submission failure | execution/cross-chain controllers | Client unavailable, wrong chain/account, provider error | Check wallet/network and retry with fresh review | send/cross-chain error events; transaction may or may not have reached wallet, inspect hash |

## Receipt monitoring

| Error / visible message | Origin | Trigger | Recovery | Logs / funds |
| --- | --- | --- | --- | --- |
| `The transaction failed before confirmation.` | `useSameChainReceiptLifecycle.js` | Wagmi receipt error while submitted | Inspect explorer/hash and wallet; retry only after state known | `receipt.failed`; gas may be spent and swap may have reverted |
| Submitted but not confirmed | receipt hook | RPC pending/no terminal receipt | Check RPC/explorer; avoid duplicate send | `receipt.monitor.tick`; funds state unknown until receipt |

## Gas Assist

| Error / visible message | Origin | Trigger | Recovery | Logs / funds |
| --- | --- | --- | --- | --- |
| `ONCHAIN_APPROVAL_REQUIRED` | 0x Gas Assist quote | Gasless route needs on-chain authorization | Prepaid sponsorship when enabled or normal funded approval path | Gas Assist hook diagnostics; no swap yet |
| Gas Assist quote/config/signature/sponsor errors | Gas Assist hooks/services | Backend disabled, expired quote, rejected signature, order failure | Refresh/retry/check wallet/config | Existing Gas Assist events; sponsorship/prepayment status must be checked |

## Cross-chain

| Error / visible message | Origin | Trigger | Recovery | Logs / funds |
| --- | --- | --- | --- | --- |
| `Cross-chain route is not ready.` / `Quote expired. Refresh the quote.` | cross-chain controller | Missing/expired route | Refresh route | cross-chain route diagnostics; no submission |
| `Route no longer matches the selected tokens.` | cross-chain controller | Chain/asset/amount/route identity changed | Requote/reopen review | cross-chain execution logs; fail closed |
| Unsafe prepared route / missing source transaction | cross-chain controller | Prepared response differs or lacks required step | Requote; inspect backend | preparation error; no source send |
| `Not enough <native> for network gas.` | review estimate | Estimated source gas exceeds balance | Fund source gas/review again | cost estimate; no source send |
| Provider/wallet/switch/approval/deposit error | shared mapping + execution service | Wallet resolution, network switching, or ordered step fails | Inspect phase, hash, chain; do not blindly retry after a hash | `[cross-chain-execution-error]`; approval/gas may be spent |

## Token catalog and wallet connection

| Error / visible message | Origin | Trigger | Recovery | Logs / funds |
| --- | --- | --- | --- | --- |
| Wallet balances could not load / stale / partial | token hooks/view model | Backend/RPC lane failure | Retry; stale usable values remain labeled | wallet classification/route diagnostics; do not assume balance |
| Market catalog error/notice | market hook/selector | Backend/search/catalog failure | Retry/search/change chain | selector diagnostics; no funds |
| Wallet connection unavailable / network switch cancelled | primary action/AppKit | origin/config issue or rejection | Check Reown settings or retry | primary action route events; no funds |

## Token selector presentation

| Error / visible message | Origin | Trigger | Recovery | First checks / logs / test |
| --- | --- | --- | --- | --- |
| `No matching tokens` | `TokenSearchResults` | Normalized search has no wallet or market match | Clear or change search; retry catalog if needed | Inspect `TokenSelector.jsx`, `useTokenSelectorState.js`, market-token service; selector tests; no funds |
| Catalog error text | `TokenSearchResults` | Parent catalog hook supplied an error | Retry catalog or use another chain | Inspect `useTokenCatalogController`, then `useMarketTokens`; catalog diagnostics; selector test; no funds |
| `This token has no contract address.` | selector context action | Native token selected for copy-address action | Use token details or copy a contract token | Inspect `TokenSelector` context menu and token identity; no network call; selector test; no funds |
| `Could not copy address` | selector context action | Clipboard API and fallback copy both failed | Retry with browser permissions | Inspect `copyText` in `useTokenSelectorState`; no selector diagnostic rename; selector test; no funds |
| `Token details are unavailable.` | selector detail service/context action | Detail URL lookup failed or returned invalid data | Retry or inspect token metadata | Inspect `getCoinGeckoTokenUrl`, then selector notice state; selector test; no funds |

## Settings

| Error / warning | Origin | Trigger | Blocks saving | Recovery / developer checks / tests |
| --- | --- | --- | --- | --- |
| `Enter a valid percentage.` | `settingsValidation.js:parseSlippageInput` | Non-numeric or malformed custom slippage | Yes for close commit; current input remains visible | Correct the input; inspect `customError`; `SwapSettingsPopover.test.jsx`; no funds |
| `Slippage must be at least 0.01%.` | `parseSlippageInput` | Parsed basis points below minimum | Yes; close falls back to Auto | Enter a larger value; inspect the model; popover test; no funds |
| `Slippage cannot exceed 100%.` | `parseSlippageInput` | Parsed basis points above 10,000 | Yes; close falls back to Auto | Enter a value at or below 100%; inspect `aria-invalid`; popover test; no funds |
| Invalid persisted settings | `services/swapSettings.js:readSwapSettings` | JSON/schema/normalization failure | No; defaults are returned | Inspect key `pistachioswap:swap-settings:v1`; storage tests; no funds |
| Storage write failure | `services/swapSettings.js:writeSwapSettings` | Browser storage unavailable or quota failure | Browser persistence may fail | Inspect storage availability and normalized value; storage tests; no funds |
| Popover focus failure | Radix content / `useSwapSettingsPopover` refs | Browser focus target unavailable or portal timing differs | No settings data loss | Inspect `onOpenAutoFocus`, `autoButtonRef`, `customInputRef`; JSDOM is limited; no funds |
