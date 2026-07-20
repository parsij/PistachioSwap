# Same-Chain Execution Extraction

## Current ownership

Before this task, `src/App.jsx` still owned quote snapshots, receipt monitoring,
and the complete approval/refresh/simulation/submission sequence. Review state,
identity closure, eligibility, and portal markup had already moved to the
same-chain review hook, model, and component.

The confirmation branch currently uses `sameChainConfirmPendingRef` for the
non-render duplicate guard. It calls `prepareSwapApproval`, reads
`getLastPreparationResult`, and force-refreshes when
`approvalTransactionSubmitted` is true. It compares the refreshed response to
`sameChainQuoteSnapshot`, the previous provider, and canonical Pancake Permit2
metadata before replacing `quoteRef`, `quoteLogicalKeyRef`, and React quote
state. It then revalidates transaction calldata, simulates, and submits.

An `AllowanceExpired` simulation error triggers one inline recovery attempt
only for Permit2/Pancake execution. Recovery invalidates Permit2 readiness,
force-refreshes, validates schema and approval binding, calls
`prepareSwapApproval(refreshedQuote)`, refreshes again if that approval sent a
transaction, re-extracts calldata, and simulates once more. There is no loop.

The block depends on: `quote`, `sameChainQuoteSnapshot`,
`currentSameChainRequestKeyRef`, `quoteConfig.endpoint`,
`quoteConfig.requireSuccessfulSimulationBeforeSend`, `swapChainId`,
`walletAddress`, `sellToken`, `buyToken`, `sourcePublicClient`,
`normalApproval.prepareSwapApproval`, `normalApproval.getLastPreparationResult`,
`normalApproval.invalidatePermit2Readiness`, `fetchSwapQuote`,
`runReadOnlySwapSimulation`, `sendTransaction`, `quoteRef`,
`quoteLogicalKeyRef`, and the quote/review/status/hash setters. Diagnostics use
`logSwapDiagnostic`, `requestKeySuffix`, `quoteDiagnostic`,
`approvalMetadataDiagnostic`, `transactionDiagnostic`, and
`executionErrorSnapshot` without changing event names.

## Proposed ownership

* `model/sameChainReviewEligibility.js`: pure review gate.
* `hooks/useSameChainReview.js`: dialog state, captured request identity, focus
  restoration, and DOM diagnostics only.
* `components/SameChainReviewDialog.jsx`: unchanged Radix portal markup.
* `services/executableTransaction.js`: pure selected-quote transaction checks.
* `services/refreshedQuoteValidation.js`: approval-refresh identity checks.
* `hooks/useSameChainExecution.js`: paid approval, refresh, recovery,
  simulation, submission, and duplicate prevention.

## State and refs

App retains token/input/quote state, quote request keys, wallet/network state,
`useWaitForTransactionReceipt`, transaction hash/status, and callbacks that
reset amounts or refresh balances. Review state owns open state, visible review
error, operation, captured identity, requested-open ref, content ref, and
trigger ref. Confirmation-pending protection moves to the execution hook.
`currentSameChainRequestKeyRef` remains in App because quote scheduling owns
it; execution receives a getter rather than importing mutable App state.

Receipt monitoring intentionally remains in App. It is a separate Wagmi
lifecycle that closes review, clears inputs/quote state, refreshes balances,
and maps receipt success/failure after the execution hook has returned a hash.

## Required dependencies

Execution needs active quote/snapshot, active chain/account/token identities,
quote endpoint/fetcher, `prepareSwapApproval`, Permit2 invalidation, public
client, wallet sender, simulation policy, state callbacks, diagnostic logger,
safe error/transaction formatters, and quote identity ref.

## Invariants and events

Preserve quote identity rejection, `review.confirm.blocked`, approval refresh,
one AllowanceExpired recovery attempt, simulation before send, receipt status,
all existing `approval.*`, `simulation.*`, `transaction.*`, `review.*`, and
`quote.refresh.*` diagnostics. Review opening cannot access wallet or RPC.
