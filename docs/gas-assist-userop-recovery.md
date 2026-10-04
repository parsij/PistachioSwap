# Submitted UserOperation recovery

The browser owns authorization, final signing and the single send. It reports
only public hashes. A submitted operation has a separate lifecycle from its
quote. A null or unavailable receipt never establishes failure.

The receipt service queries the host-private Bundler ingress at
`127.0.0.1:4338/rpc` (the existing compose binding), with a four-second deadline.
Concurrent/order-status reads share a bounded ten-second cooldown. The returned
transaction hash is an untrusted hint passed to the existing BSC EntryPoint
verifier. Hash, event count, EntryPoint, sender, Paymaster, nonce, transaction
status and UserOperation success are all checked there.

Public recovery accepts only order ID, wallet address and canonical userOpHash.
The hash must match the stored sponsored unsigned operation and Paymaster data.
It exposes only public identifiers and verified status; the full order still
requires wallet authentication. A missed submission report can be restored from
these public identifiers, including after quote expiry, without another send.
It never accepts user signatures or execution payloads.

Same-chain: submitted -> source-confirmed -> completed (or verified failure).
Cross-chain: submitted -> source-confirmed-awaiting-destination. Source success
never completes the destination. The public API independently verifies the
order/route binding before restoring cross-chain provider tracking.

# Production acceptance

Use a tiny amount and a fresh reviewed order. Record public identifiers only.
1. Count `eth_sendUserOperation` requests: exactly one.
2. Delay browser receipt responses beyond the first 60 polls; retain normal
   backend access. Confirm delayed/submitted UX without a retry action.
3. Close the modal. Refresh and reopen. Verify no authorization, operation
   signing or send occurs during recovery.
4. Verify the backend discovers the source transaction by userOpHash and accepts
   it only after the exact EntryPoint event is verified.
5. For same-chain, verify completion; for cross-chain, verify source-confirmed
   and destination waiting, then provider-confirmed destination separately.
6. Temporarily fail receipt/status reads: state remains unresolved, retries back
   off, and visibility restores polling. Quote expiry must not affect execution.
7. Test a verified reverted receipt: failure with no destination advance.
8. Inspect storage and diagnostics: no signatures, keys, auth tokens or private
   provider URLs. An unresolved operation remains recorded after 24 hours, with
   low-frequency recovery and no resubmission.

This checklist is prepared acceptance work, not evidence of a live funded swap.

The browser stores only whitelisted public identifiers under the existing
`pistachioswap:` local-storage convention. A Web Lock serializes same-order
submissions across tabs. Browsers without Web Locks cannot start a send.
An expected public hash is persisted before an ambiguous send boundary.
Recovery polls at 5/10/15 seconds and at 60 seconds after 24 hours; terminal
states clear the record, while unresolved state never expires with a quote.
Closing preserves state; unmount/account changes abort reads. Recovery resumes
when visible. No authentication token is persisted and no operation is re-signed.

Local full frontend tests have pre-existing failures on untouched main,
including obsolete Particle interfaces. The recovery suites, API suite, lint,
typecheck and build are validated separately; required CI must pass before merge.
