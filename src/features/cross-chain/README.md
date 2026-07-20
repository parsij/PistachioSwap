# Cross-Chain Feature

## Purpose

Owns cross-chain quote requests, route selection/sorting, review preparation/cost estimation, wallet authentication, ordered approval/source transactions, and cross-chain UI.

## Responsibilities and files

- `hooks/useCrossChainController.js`: page-level cross-chain state machine and review lifecycle.
- `hooks/useCrossChainRoutes.js`: debounce, cancellation, backend quote/prepare/claim/status API lifecycle.
- `services/crossChainRoutes.js`: request/response normalization, identity, expiry, sorting, public route storage.
- `services/crossChainExecution.js`: wallet resolution, chain switching, gas estimation, prepared transaction validation/submission, receipt waiting.
- `components/CrossChainRouteCards.jsx`, `CrossChainReviewDialog.jsx`, `ChainSelector.jsx`: presentation.

## What does not belong here

Normal same-chain approvals/simulation, Gas Assist, token catalog loading, passkey vault internals, or backend provider adapters.

## Flow

`normalized exact-input intent -> useCrossChainRoutes -> backend route response -> normalized/ranked route -> route cards -> open review -> prepare route -> estimate source gas -> confirm -> resolve/switch wallet -> approval steps -> claim source -> source transaction -> mark submitted`.

## Inputs, outputs, side effects, and errors

The controller accepts account/wallet, chains/assets/amount/slippage, backend endpoint/version, public client/Wagmi config/network switch, native balance/token, and semantic status/transaction callbacks. It returns current route/status, route-list API, review view model, and refresh/open operations. HTTP/RPC/wallet/signature/transaction work is confined to hooks/services and explicit confirmation.

Errors include disconnected/wrong-chain state, route absence/expiry/mismatch, unsafe preparation, missing source transaction, gas-estimate unavailability, insufficient native gas, provider/wallet resolution, rejection, approval, claim, and source submission. Visible mapping remains in controller/shared diagnostics.

## Logging and security

Preserve `[cross-chain-execution]`, `[cross-chain-execution-error]`, and `[cross-chain-cost-estimate]`. Route/account/chains/assets/amount/expiry and transaction target are revalidated before wallet operations. Provider secrets remain backend-only.

## Tests and mocked limitations

Focused tests cover route service/hook/cards/execution and App composition. They mock HTTP, Wagmi, Viem clients, wallet providers, timers, signatures, and receipts; they do not prove live route/provider execution or settlement.

## Common manual edits and debt

Backend request lifecycle: route hook; browser execution: controller/service; display: components. The route service is large because it normalizes several provider response shapes; provider-specific normalization could be separated after contract tests are expanded.
