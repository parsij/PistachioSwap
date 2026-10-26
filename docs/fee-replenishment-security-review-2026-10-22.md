# Fee replenishment browser security fixes — 2026-10-22

Reviewed PR #229 at `0b7144fdf0ca10837b6d6e5ddebdedecd355eda2`, based on main `2b5440d5da69615100e79a51788c792eb326efee`. Fixes remain on the existing PR branch. No merge, deployment, production setting change, real signing, wallet connection or broadcast occurred.

## Fixed findings

- **Medium:** a Bundler-reported failure became PAYMASTER_EXECUTION_REVERTED even when backend receipt verification was unavailable. `selfHostedPaymaster.js` now requires matching backend-verified `sourceStatus=reverted`; unverified evidence stays pending. The new outage/unverified-failure test failed before the fix and passes afterward. The expected public hash remains persisted before the ambiguous send boundary, and no blind retry is introduced.
- **Low:** browser deployment verification checked refill runtime/settings but omitted its router/spender allowlist. `feeRefill.js` now independently checks routeAllowed before wallet authorization, with rejection tests.

Both five-call treasury and eight-call refill batches still undergo exact amount, fee, token, spender, destination, calldata, chain and expiry checks. All eight calls remain bound to the built-in wallet's reviewed single-confirmation calldata scope. External-wallet-compatible adapters use the same encoder and policy. Real wallet app/extension sessions were not exercised.

Validation: all **349 Gas Assist/passkey tests** passed, changed-file oxlint passed, and production Vite build passed (existing chunk/plugin performance warnings). Full frontend runs abort with `fatal library error, lookup self`; four walletHistoryClassifier failures and one PortfolioPage failure reproduce on the untouched PR head. Do not represent the full frontend release gate as green.

Matching backend/contract fixes, protocol/fork evidence, additive SQL migration and remaining deployment blockers are documented in [Gas-Assist PR #128](https://github.com/parsij/Gas-Assist/pull/128) and its private `docs/fee-replenishment-security-review-2026-10-22.md`. The fixed refill contract needs a reviewed new deployment/runtime hash; the existing Paymaster remains. No commercial pricing or automatic unused-gas-refund behavior changed. Automated checks do not establish production safety.
