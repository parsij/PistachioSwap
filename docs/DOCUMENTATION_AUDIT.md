# Documentation Audit

## Scope

Audited first-party runtime and tests under `src/`, `apps/api/src/`, `apps/api/scripts/`, and `docs/`, excluding dependencies, generated output, fixtures, and build artifacts. Current paths were checked against the workspace source tree.

## Architecture Coverage

- Application shell: `src/app/README.md`
- Swap, approvals, tokens, settings, wallet/passkey, Gas Assist, cross-chain, and shared feature READMEs
- Backend quote feature: `apps/api/src/features/quotes/README.md`
- Wallet manager facade and clusters: `docs/WALLET_MANAGER.md`, `docs/refactor/WALLET_MANAGER_DECOMPOSITION.md`
- UI index and flows: `docs/UI_COMPONENT_INDEX.md`, `docs/UI_DATA_FLOW.md`
- Error and debugging references: `docs/ERROR_CATALOG.md`, `docs/DEBUG_CHECKLISTS.md`

## Verification

The wallet-manager architecture test verifies cluster uniqueness, deterministic installation order, manager receiver usage, and the public UI boundary. Existing focused wallet/controller tests remain the behavior characterization suite.

Stale approval names and legacy wallet-screen paths were searched in first-party source and documentation. Historical references remain only where explicitly describing prior refactor work. No runtime UI imports the internal wallet-manager clusters.

## Intentional Gaps

Some generated or highly granular backend provider exports are covered by their parent feature README rather than one Markdown file per private helper. Mocked tests cannot prove real WebAuthn, wallet cryptography, secure storage, provider responses, RPC behavior, signing, transaction submission, or browser layout.
