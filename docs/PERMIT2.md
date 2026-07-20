# Permit2

Permit2 is an authorization contract. The owner first grants the token an
ERC-20 allowance to the Permit2 contract; Permit2 then grants the router a
token allowance containing token, owner, spender, amount, expiration, and
nonce. `src/features/approvals/hooks/useSwapApproval.js` enforces the existing
short expiration policy and exact router binding.

A wallet holding BNB can pay gas but still needs token authorization before a
router can move XAUT or another ERC-20. Native BNB has no ERC-20/Permit2 step.
