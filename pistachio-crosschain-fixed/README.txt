PistachioSwap cross-chain fixes

Replacement files:
- apps/api/src/cross-chain/validation.ts
  Accepts missing/zero gas estimates as unavailable and normalizes positive hex gas.
- apps/api/src/cross-chain/adapters/relay/index.ts
  Accepts authoritative Relay ApprovalProxy execution when sufficient allowance makes Relay omit the approval step.
- src/features/cross-chain/hooks/useCrossChainRoutes.js
  Supports preparing an explicit freshly quoted route, reuses the scoped wallet-auth session, and resets per-route claim state.
- src/features/cross-chain/hooks/useCrossChainController.js
  Waits for approval confirmation, fetches and prepares a fresh same-provider route, rejects worse output or changed approval, and submits only fresh calldata.
- src/features/cross-chain/components/CrossChainReviewDialog.jsx
  Mounts the Radix portal inside the CSS-variable boundary and shows preparation/refresh state.
- src/features/cross-chain/components/crossChain.css
  Makes the review dialog opaque, readable, centered, scrollable, and higher than diagnostic controls.
- apps/api/test/cross-chain.test.ts
  Adds regressions for zero/hex gas metadata and Relay routes that omit approval after allowance exists.

Apply from the extracted folder:
  ./apply-fixed-files.sh /home/arch/WebstormProjects/pistachioswap_lite

Then run from the repository:
  pnpm --filter @pistachio/api typecheck
  pnpm --filter @pistachio/api test -- cross-chain.test.ts
  pnpm exec oxlint \
    apps/api/src/cross-chain/validation.ts \
    apps/api/src/cross-chain/adapters/relay/index.ts \
    src/features/cross-chain/hooks/useCrossChainRoutes.js \
    src/features/cross-chain/hooks/useCrossChainController.js \
    src/features/cross-chain/components/CrossChainReviewDialog.jsx
  git diff --check

No server is started by the apply script.
