# Approvals

Wallet BNB balance pays a normal wallet transaction; it is not token
authorization. Token allowance authorizes a contract to spend an ERC-20.
`useSwapApproval` performs a direct exact ERC-20 approval or a Permit2
two-layer authorization based on canonical quote metadata. Gas Assist is a
separate sponsored/gasless feature; a gasless signature is not an ERC-20
approval and must not be treated as one.

The normal flow validates chain, token, exact spender, executable target, and
required amount; then waits for receipts and re-reads allowances. See
`docs/PERMIT2.md`.
