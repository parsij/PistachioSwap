# One-confirmation swaps

Open the swap card's settings gear and enable **One-confirmation swaps**. This selects the existing forced Gas Assist preference, including when the wallet has native gas. It remains off unless that preference was already selected. Turning it off restores Auto. The separate Gas Assist selector can also choose Auto or Normal gas.

This option uses the existing ERC-4337/EIP-7702 source batch; it does not introduce a new contract or universal EIP-5792 support. Eligible Pistachio Wallet swaps combine the quoted token service charge, allowance reset, exact approval, provider call and final allowance reset. Review the quote once, then authorize the supported signing flow with one passkey verification. The quoted token charge applies; the option is not free sponsorship. An unsupported route remains blocked with its existing eligibility reason.

## Signing boundary

After the explicit quote confirmation, the browser verifies the authenticated order and prepared five-call plan. The Paymaster service establishes an internal, memory-only wallet handoff, bound to the batch calldata, account, vault, chain, trusted delegate and Paymaster. This handoff is not available through provider RPC. It expires within two minutes or the prepared intent's earlier expiry.

The authentication challenge, trusted delegation authorization and final PackedUserOperation use the bounded unlock. The final typed-data schema/domain, sender, batch, delegate and Paymaster must match the handoff. An unrelated or changed typed-data request is rejected during that handoff. Normal sends, arbitrary messages, Permit2 authorizations and external wallets do not acquire a generic auto-approve permission. Signing completion, failure, cancellation or expiry ends the handoff and discards the unlocked worker state through the existing lock path.

A different existing EIP-7702 delegate still requires a separate wallet review. A changed authenticated quote still requires renewed review. Device/authentication failures, expired scopes, wallet/account changes and external wallets can require additional verification. Cross-chain destination fulfillment remains separate from the atomic source operation. Disabling the option does not revoke an on-chain delegation or existing approval.

## Verification and limits

`walletManagerSmartSwap.test.js` exercises the real authentication, delegation and typed-data signing methods with a synthetic local signer and a stubbed worker transport. It checks the passkey/unlock count, provider JSON serialization, operation mismatches, replacement-delegate review, expiry, ordinary typed-data rejection, and fresh review after completion. It does not exercise a physical authenticator, production RPC, real funds or a deployed account contract.

The Terms and Privacy remain published pre-launch drafts. Operator identity, monitored contacts, actual production data practices, jurisdiction decisions and final service-charge remedies need operator/counsel completion. Published terms and passing tests do not establish licensing exemption or authorization to launch.
