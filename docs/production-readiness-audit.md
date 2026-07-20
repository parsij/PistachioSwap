# PistachioSwap Production Readiness Audit

Audit date: 2026-07-19  
Repository: `/home/arch/WebstormProjects/pistachioswap_lite`  
Starting revision: `bacb076` on `main`  
Scope: frontend, API, database, providers, wallet, transaction execution, caching, persistence, security, performance, reliability, accessibility, and responsive UI.

This is an exhaustive best-effort audit, not a claim that the project is flawless or bug-free. The worktree was already extensively dirty and all existing changes were treated as user-owned. No persistent server was started. No wallet prompt was accepted and no signing, approval, submission, or transaction broadcast occurred.

## 1. Executive summary

The audit found and fixed four P0 transaction-policy defects, five code-level P1 reliability defects, and multiple P2 reliability/accessibility/performance defects. The highest-impact fixes bind approval and execution to the selected chain and exact token addresses, reject arbitrary 0x allowance spenders, make bounded approval the default for gasless permits, and prevent exact-output swaps from approving less than their maximum sell amount.

The repository is **not ready under the current local production configuration**. `apps/api/.env` contains `DEBRIDGE_ENABLED=flase`; the corrected parser now fails closed, so the API will not start until an operator changes that value to `false` or `true`. This file was deliberately not edited. Production promotion also requires an independent passkey-wallet/security audit, cancellation-based wallet tests, live credentialed provider tests, deployment security-header/readiness validation, and a decision on the remaining transitive dependency advisories.

## 2. Architecture and request flows

- **Frontend:** Vite + React 19 in `src/`; `main.jsx` installs the top-level recovery boundary and AppKit/Wagmi provider, while `App.jsx` owns the normal same-chain/cross-chain swap workflow.
- **API:** Fastify 5 + TypeScript in `apps/api/src`; strict config parsing, CORS allowlist, rate limiting, safe errors/log redaction, route modules, startup hooks, rolling catalog refresh, and graceful shutdown.
- **Database:** PostgreSQL + Drizzle for Gas Assist, gasless/prepaid sponsorship, usage controls, cross-chain authentication/routes, and market-catalog snapshots.
- **Same-chain quote:** stable browser request identity -> `/v1/quote` -> isolated Uniswap/0x/Pancake adapters -> normalized quote -> expiry/identity review -> exact approval -> wallet submission.
- **Cross-chain quote:** `/v1/cross-chain/quotes` -> provider-neutral registry -> Relay/Across/deBridge/optional providers -> normalized route/costs -> wallet authentication -> preparation -> source gas estimate -> review -> claim -> source approval/deposit -> idempotent status updates.
- **Wallet tokens:** one browser all-chain request -> bounded API-side Alchemy network batches and independent pagination -> exact-address classification/security enrichment -> partial/stale semantics.
- **Market tokens:** memory/persistent catalog -> rolling one-chain refresh -> provider discovery and exact-address recognition -> ranked/common lists -> ETag revalidation.
- **Passkey wallet:** WebAuthn PRF -> HKDF KEK -> random AES-GCM DEK/IVs -> IndexedDB encrypted vault -> worker-held signer -> explicit review queue -> EIP-1193 connector.
- **Secrets:** API/database/provider credentials are server-only variables; only public `VITE_` configuration enters the browser bundle.

## 3. Baseline

| Check | Baseline result |
|---|---|
| Worktree | Dirty with extensive existing work; preserved |
| Runtime | Node `v24.13.0`, pnpm `10.30.3`; no engine constraint |
| API tests | 21 files, 321 tests passed |
| API typecheck | Passed |
| Lint | Passed with one existing unused diagnostic-script variable warning |
| Root tests | Initial combined output was not retained; the final run is authoritative |
| React Doctor | Invocation completed but output was not retained; an earlier non-comparable snapshot was 30/100 with 97 raw findings |
| Dependency audit | 2 high and 4 moderate advisories |
| `git diff --check` | Passed |
| Build | Deferred to the one final build |

## 4. Finding totals

| Severity | Fixed | Partial | Unresolved | Total |
|---|---:|---:|---:|---:|
| P0 | 4 | 0 | 0 | 4 |
| P1 | 5 | 0 | 1 environmental | 6 |
| P2 | 13 | 1 | 2 | 16 |
| P3 | 1 | 0 | 1 | 2 |
| **Total** | **23** | **1** | **4** | **28** |

## 5. Issue ledger

Each entry includes evidence, reproduction, cause, fix, coverage, verification, and residual risk.

### PRA-001 - P0 - Approval resolved on the wrong chain

- **Category/files:** transaction correctness; `src/features/approvals/hooks/useSwapApproval.js`, `src/features/swap/hooks/useSameChainExecution.js`.
- **Evidence/reproduction:** the hook hardcoded `usePublicClient({ chainId: 56 })` and an unscoped wallet client; select a non-BSC same-chain route and review approval.
- **Root cause:** approval clients were not derived from the selected route chain.
- **Fix:** resolve both clients with the selected chain and validate quote/wallet client chain before approval.
- **Regression test:** wrong-chain client and quote cases in `src/features/approvals/hooks/useSwapApproval.test.jsx`.
- **Verification/residual:** focused and full tests passed; real wallet chain-switch cancellation remains manual.

### PRA-002 - P0 - Executable quote was not bound to selected assets

- **Category/files:** transaction correctness; `src/services/swapTransaction.js`, `src/App.jsx`.
- **Evidence/reproduction:** a syntactically valid stale quote could reach execution after selected chain/token state changed.
- **Root cause:** execution validation did not receive the current exact chain/sell/buy identity.
- **Fix:** require and compare expected chain and canonical sell/buy addresses before any wallet request.
- **Regression test:** wrong-chain and wrong-token executable quote tests.
- **Verification/residual:** focused and full tests passed; provider calldata still requires wallet review.

### PRA-003 - P0 - Arbitrary 0x allowance spender accepted

- **Category/files:** approval security; `apps/api/src/providers/quotes/zero-x-provider.ts`.
- **Evidence/reproduction:** return a valid-looking quote with an attacker-controlled `allowanceTarget`.
- **Root cause:** the adapter syntax-checked but did not authenticate AllowanceHolder.
- **Fix:** chain-map official 0x AllowanceHolder addresses, reject mismatches, and expose only the authoritative address.
- **Regression test:** arbitrary target rejection and official holder normalization in `quotes.test.ts`.
- **Verification/residual:** 13 focused quote tests and full API tests passed. 0x Settler remains intentionally dynamic; it is not approved as a spender.

### PRA-004 - P0 - Unlimited permit acceptance was default-on

- **Category/files:** approval security/config; `apps/api/src/config.ts`, `.env.example`, `docs/gas-assist.md`.
- **Evidence/reproduction:** omit `GAS_ASSIST_REJECT_UNLIMITED_PERMITS`; unlimited permit fixtures were accepted.
- **Root cause:** a high-risk compatibility option defaulted permissively.
- **Fix:** reject unlimited permits by default; an operator must explicitly choose the compatibility override.
- **Regression test:** default unlimited rejection and bounded permit acceptance in `gasless-v2.test.ts`.
- **Verification/residual:** 35 focused tests and full API tests passed; an explicit `false` override remains an operator risk.

### PRA-005 - P1 - Exact-output approval could be too small

- **Category/files:** swap execution; `src/features/approvals/hooks/useSwapApproval.js`.
- **Evidence/reproduction:** quote exact output where actual sell usage may rise to `maximumSellAmount`; prior approval used the estimate.
- **Root cause:** exact-input and exact-output approval requirements were conflated.
- **Fix:** approve the bounded maximum sell amount for exact output; reject missing/zero/mismatched allowance data.
- **Regression test:** exact encoded maximum plus missing/zero/wrong-token cases.
- **Verification/residual:** four focused tests and full root suite passed.

### PRA-006 - P1 - Malformed configuration silently changed policy

- **Category/files:** configuration; `apps/api/src/config.ts`, wallet-token tests.
- **Evidence/reproduction:** `ESTABLISHED_TOKEN_SNAPSHOT_ENABLED=flase` used a default; malformed policy addresses were ignored.
- **Root cause:** permissive readers treated invalid values as absent.
- **Fix:** strict booleans, bounded integers, server ports, and exact address sets fail at startup.
- **Regression test:** malformed boolean/integer/port/blocklist assertions.
- **Verification/residual:** 36 config/wallet tests plus final typecheck passed; the real env now correctly blocks startup (PRA-010).

### PRA-007 - P1 - Cross-chain auth/route memory exhaustion

- **Category/files:** availability; `cross-chain/auth.ts`, `cross-chain/repository.ts`.
- **Evidence/reproduction:** continuously create unique auth challenges/sessions/routes under in-memory fallback.
- **Root cause:** maps had no maximum size.
- **Fix:** prune expired/consumed state, enforce capacity, and fail with explicit 503 codes.
- **Regression test:** capacity rejection and expiry recovery tests.
- **Verification/residual:** 37 auth/route focused tests and full API suite passed; PostgreSQL is still required for durable multi-instance production state.

### PRA-008 - P1 - Concurrent migrations could race

- **Category/files:** database/startup; `apps/api/scripts/migrate.ts`.
- **Evidence/reproduction:** start two deployment migration commands against one database.
- **Root cause:** migration-table reads and DDL were not serialized.
- **Fix:** one dedicated connection holds a PostgreSQL advisory lock; each migration is transactional and unlocks/releases in `finally`.
- **Regression test:** static/typechecked runner; destructive database concurrency was not executed.
- **Verification/residual:** API typecheck passed; a staging PostgreSQL two-run test remains required.

### PRA-009 - P1 - SIGTERM bypassed backend cleanup

- **Category/files:** reliability; `server.ts`, `lib/shutdown.ts`.
- **Evidence/reproduction:** send SIGTERM to the API; no signal handler called `app.close()`.
- **Root cause:** cleanup hooks existed but were not connected to process termination.
- **Fix:** idempotent SIGINT/SIGTERM handler closes Fastify once and records cleanup failure.
- **Regression test:** concurrent signals close once; failure is reported without rejection.
- **Verification/residual:** two focused and 332 full API tests passed; real orchestrator termination timing remains staging work.

### PRA-010 - P1 - Current API environment is invalid (unresolved)

- **Category/files:** deployment environment; `apps/api/.env` (not modified).
- **Evidence/reproduction:** the read-only diagnostic exits with `DEBRIDGE_ENABLED must be either true or false.` because the value is `flase`.
- **Root cause:** operator typo previously hidden by permissive parsing.
- **Fix:** code now fails closed. Operator must change the real value to `false` or `true`.
- **Regression test:** malformed-boolean startup test.
- **Verification/residual:** reproduced locally; blocks production startup until manually corrected.

### PRA-011 - P2 - Gasless polling stopped early

- **Category/files:** reliability; `useZeroXGaslessSwap.js`.
- **Evidence/reproduction:** `pending` followed by a transient status error never scheduled another poll.
- **Root cause/fix:** status rather than attempt revision drove the effect; advance revision after every nonterminal attempt.
- **Regression test/verification:** pending -> error -> confirmed with one submission; six tests passed.
- **Residual:** live provider latency remains manual.

### PRA-012 - P2 - Sponsorship stale async results and stopped polling

- **Category/files:** wallet/reliability; `usePrepaidSponsorship.js`.
- **Evidence/reproduction:** change wallet during authentication/order creation or inject a transient status failure.
- **Root cause/fix:** add wallet epochs, abort ownership, and poll revisions.
- **Regression test/verification:** stale order suppression and transient recovery; two focused tests passed.
- **Residual:** private signing compatibility is wallet-specific.

### PRA-013 - P2 - Cross-chain refresh/preparation races

- **Category/files:** cross-chain UX; `useCrossChainRoutes.js`.
- **Evidence/reproduction:** refresh a valid route through a transient failure or replace route/account during preparation.
- **Root cause/fix:** preserve valid same-context routes and sequence-own authentication/preparation results.
- **Regression test/verification:** four focused tests passed.
- **Residual:** live authenticated preparation was not attempted.

### PRA-014 - P2 - Wallet-token failure dropped degraded metadata

- **Category/files:** wallet portfolio; `useWalletTokens.js`.
- **Evidence/reproduction:** fail refresh after a partial response; provider/chain status disappeared.
- **Root cause/fix:** the catch rebuilt a subset; retain the full previous contract while marking stale/error.
- **Regression test/verification:** eight focused tests and full suite passed.
- **Residual:** upstream metadata quality remains provider-dependent.

### PRA-015 - P2 - Market refresh erased useful data

- **Category/files:** market catalog; `useMarketTokens.js`.
- **Evidence/reproduction:** visible all-chain revalidation returns an empty degraded result or throws.
- **Root cause/fix:** cold-start handling was reused for refresh; retain useful tokens/common lists as stale/partial.
- **Regression test/verification:** eight focused tests passed.
- **Residual:** UI still depends on eventual backend recovery.

### PRA-016 - P2 - Failed catalog schedule was not durable

- **Category/files:** persistence; market-catalog persistence/service.
- **Evidence/reproduction:** first refresh fails before a usable catalog row, then restart.
- **Root cause/fix:** update-only attempt persistence; upsert a schema-versioned schedule placeholder without serving it as a catalog.
- **Regression test/verification:** 14 focused persistence tests passed.
- **Residual:** real PostgreSQL restart/hydration remains staging work.

### PRA-017 - P2 - Deterministic 0x GET errors were retried

- **Category/files:** provider reliability; `zero-x/gasless-client.ts`.
- **Evidence/reproduction:** return auth/validation 4xx and count requests.
- **Root cause/fix:** unclassified retries; retry only transport, 429, and 5xx failures.
- **Regression test/verification:** call-count coverage and 35 focused tests passed.
- **Residual:** live 0x rate-limit headers were not forced.

### PRA-018 - P2 - Unbounded application caches

- **Category/files:** frontend quote cache and API provider/security/logo caches.
- **Evidence/reproduction:** issue unlimited unique amount/address/search keys.
- **Root cause/fix:** plain maps had TTL but no cardinality bound; use bounded insertion/LRU-like touch and expiry pruning.
- **Regression test/verification:** quote cache capped at 100; shared bounded-cache and 71 focused provider tests passed.
- **Residual:** process-wide memory profiling under production traffic remains required.

### PRA-019 - P2 - Unbounded upstream response bodies

- **Category/files:** provider HTTP; `apps/api/src/lib/http.ts`.
- **Evidence/reproduction:** upstream returns oversized declared or chunked JSON.
- **Root cause/fix:** `response.text()` buffered without a limit; enforce a 5 MiB declared/streamed cap and do not retry the deterministic failure.
- **Regression test/verification:** declared/chunked/no-retry boundary tests passed.
- **Residual:** per-provider tighter limits may improve defense further.

### PRA-020 - P2 - Review overlays lacked complete modal behavior

- **Category/files:** UI/accessibility; `src/App.jsx`.
- **Evidence/reproduction:** keyboard through same/cross-chain review; manual overlay did not demonstrate trap, Escape, return focus, or lock.
- **Root cause/fix:** replace overlay semantics with existing Radix Dialog while preserving layout and flow.
- **Regression test/verification:** App tests and full root suite passed.
- **Residual:** screen-reader/manual mobile testing remains required.

### PRA-021 - P2 - Uncaught render errors produced a blank app

- **Category/files:** frontend reliability; `AppErrorBoundary.jsx`, `main.jsx`.
- **Evidence/reproduction:** throw during provider/component render.
- **Root cause/fix:** no top-level boundary; show a non-sensitive recovery state with reload.
- **Regression test/verification:** focused boundary test and full root suite passed.
- **Residual:** runtime error telemetry is not configured.

### PRA-022 - P2 - Dependency advisories (partial)

- **Category/files:** supply chain; root package/lockfile.
- **Evidence/reproduction:** baseline `pnpm audit --prod`: two high/four moderate.
- **Root cause/fix:** scoped overrides update API viem `ws` to 8.21.0 and Pancake `bn.js` to 5.2.3.
- **Regression test/verification:** install, full tests, typecheck, and build passed; final audit is one high/two moderate.
- **Residual:** unpatched `bigint-buffer` through Pancake/Solana and UUID 8/9 major-upgrade paths remain. No vulnerable UUID buffer APIs were found in app code, but transitive runtime behavior was not exhaustively proven unreachable.

### PRA-023 - P2 - Dynamic provider transaction trust boundary (unresolved)

- **Category/files:** provider supply-chain trust; quote adapters/execution.
- **Evidence/reproduction:** authenticated providers supply dynamic transaction targets/calldata.
- **Root cause:** some settlement contracts, including 0x Settler, are intentionally dynamic.
- **Fix:** exact chain/token/recipient/spender/amount/expiry checks remain; do not approve Settler.
- **Regression test/verification:** transaction trust-boundary suites passed.
- **Residual:** a compromised provider/API can still propose malicious calldata; wallet review and independent security review remain necessary.

### PRA-024 - P2 - Deployment readiness/security headers absent from app (unresolved)

- **Category/files:** deployment/API; `/health`, deployment edge configuration.
- **Evidence/reproduction:** `/health` is liveness-only; the repository does not prove CSP/HSTS/frame policy at the production edge.
- **Root cause:** readiness and browser headers are deployment-owned and not represented here.
- **Fix:** none applied without the deployment contract.
- **Regression test/verification:** liveness route works; production edge and database/provider readiness are unverified.
- **Residual:** misconfigured deployment can expose framing/XSS or route traffic to a degraded instance.

### PRA-025 - P2 - Browser quote cache cardinality

- **Category/files:** performance; `src/features/swap/services/quotes.js`.
- **Evidence/reproduction:** request 105 distinct quote identities.
- **Root cause/fix:** TTL-only map; prune expiry, touch hits, cap at 100.
- **Regression test/verification:** six focused tests and full suite passed.
- **Residual:** cache hit rate needs production measurement.

### PRA-026 - P2 - Invalid server ports reached Fastify

- **Category/files:** startup; `config.ts`, `server.ts`.
- **Evidence/reproduction:** set `PORT=0`, `65536`, or fractional input.
- **Root cause/fix:** direct `Number` conversion lacked bounds; strict 1..65535 integer parser.
- **Regression test/verification:** port cases and API typecheck passed.
- **Residual:** host/network binding remains deployment-owned.

### PRA-027 - P3 - Cross-chain diagnostic hid quote failures

- **Category/files:** observability; `diagnose-cross-chain.ts`.
- **Evidence/reproduction:** diagnostic returned an empty route list without a safe failure reason.
- **Root cause/fix:** generic exceptions were swallowed; output safe code/message and normalized cost summary without calldata or full addresses.
- **Regression test/verification:** finite live read-only run produced a Relay route/cost summary.
- **Residual:** diagnostic fixtures are live-provider dependent.

### PRA-028 - P3 - Existing lint warning (unresolved)

- **Category/files:** maintainability; `apps/api/scripts/debug-zero-x-live.ts:12`.
- **Evidence/reproduction:** `pnpm lint` reports unused `DEFAULT_TAKER`.
- **Root cause:** diagnostic script drift.
- **Fix/test:** not changed because it is harmless and unrelated to runtime behavior.
- **Verification/residual:** lint exits zero with one warning.

## 6. Cross-chain cost verification

Relay mapping uses the current response shape:

- `expandedPriceImpact.execution` -> destination execution cost, falling back to `fees.relayerGas.amountUsd`.
- `expandedPriceImpact.relay` -> provider fee, falling back to `fees.relayerService.amountUsd`.
- `expandedPriceImpact.app` -> PistachioSwap fee, falling back to `fees.app.amountUsd`.
- `expandedPriceImpact.swap` -> separately reported route/swap impact.
- `expandedPriceImpact.sponsored` -> sponsored reduction, falling back to `fees.subsidized.amountUsd`.
- `fees.relayer` is excluded because it combines service and gas. Expanded execution is not added to relayer gas. Minimum output is not a fee and remains unchanged.

Signed negative impacts are normalized to non-negative magnitudes. Decimal-string/BigInt helpers add costs and subtract sponsorship without JavaScript floating-point arithmetic. Other providers return the same normalized structure with unsupported components left `null`; frontend rendering contains no Relay field names.

Prepared source gas estimates exact approval and deposit transactions with `{ account, to, data, value }`, viem `estimateGas`, `estimateFeesPerGas` with gas-price fallback, and BigInt multiplication/summation. Native input skips approval. Display-safe native pricing converts the estimate to USD without promoting market price to a trusted security price. The prepared total is published only while the same review/route is current; estimation never submits a transaction. Insufficient native balance disables confirmation with `Not enough [symbol] for network gas.`

Quote UI shows route costs and `Calculated at confirmation` for unknown source gas. Prepared review shows the best total and breakdown plus final-gas variability. Unknown values are omitted or described honestly and are never labeled `Free`; input/output fiat difference is never used as a fabricated fee.

## 7. Security and wallet findings

- Exact-address, chain, recipient, owner, amount, spender, expiry, route-key, and prepared-route binding are retained across same-chain, cross-chain, Gas Assist, and sponsorship paths.
- Gas Assist remains same-chain-only and uses backend policy, bounded approvals, idempotency, wallet binding, expiry, usage/rate controls, and signed-transaction validation.
- Passkey code uses random AES-GCM IVs/DEKs, HKDF domain context, PRF verification, encrypted IndexedDB persistence, worker-held active signing material, explicit review, inactivity locking, and origin/RP restrictions. Private-key reveal/export is an explicit authenticated user action.
- Cryptography and WebAuthn ceremonies were not independently validated. This wallet remains security-sensitive and requires a professional cryptography/application audit before production custody claims.
- Logs redact signatures, signed transactions, session tokens, authorization, and API-key headers. The built artifact contained no configured backend credential value.
- No exploit code or live transaction action was used.

## 8. Provider and data reliability

- Provider calls use explicit chain maps, timeouts, normalized safe errors, bounded response bodies, isolated failures, and partial/stale caches.
- 0x deterministic 4xx errors no longer retry. Relay/Across/deBridge capability and quote failures remain provider-specific.
- Market refresh cannot erase useful data on empty/error/429 paths; attempt schedules persist independently of catalog availability.
- Wallet Portfolio remains one browser request with backend batching, bounded concurrency, independent pagination, stale retention, and provider rejection isolation.
- Live behavior for Alchemy, Uniswap, Pancake, 0x signing/status, MegaFuel, GoPlus, Honeypot, Moralis, and production RPCs was not exercised with transactions.

## 9. UI, accessibility, and responsive findings

- Swap review dialogs now use Radix focus trapping, Escape handling, portal layering, scroll locking, and focus return.
- Cross-chain route selection uses native toggle-button semantics rather than a misleading listbox/option model.
- Token selector uses fixed desktop and viewport-safe mobile height with internal scrolling and stable empty/small-list dimensions.
- The top-level boundary prevents an opaque blank screen and does not expose internal errors.
- React Doctor found 170 raw diagnostics (46 error, 124 warning), score 26/100. Most error findings were compiler heuristics around deliberate state synchronization or parser false positives in security-sensitive wallet code. One actual ARIA-model issue was fixed. Large component/memoization/refactor suggestions were not applied without behavioral evidence.
- Keyboard-only, screen-reader, reduced-motion, short-viewport, and mobile behavior still require manual browser verification.

## 10. Performance findings

- Quote/provider/security/logo caches and in-memory cross-chain stores now have cardinality limits.
- Provider JSON has a 5 MiB hard cap; catalog provider fan-out and wallet batching are bounded.
- Production build main chunk: 1,177.20 kB minified / 353.04 kB gzip. Several AppKit wallet chunks exceed 500 kB. Code splitting is a remaining P2 performance opportunity but was not attempted during a correctness audit.
- Build warned that a transitive `ox` worker utility imports `node:worker_threads`, externalized for browser compatibility. The build and wallet-worker tests passed, but browser coverage across wallet paths is still required.
- No database query timing, production cache hit rate, browser render profile, or load test was available.

## 11. Database and migrations

- Schema review found exact numeric amounts, timezone-aware timestamps, unique transaction/signature hashes, usage uniqueness, and lookup/status/expiry indexes on critical tables.
- Migration execution now serializes with an advisory lock and wraps each file in a transaction.
- No audit migration was added. Existing uncommitted `0005_market_token_catalog_cache.sql` was preserved and covered by persistence tests.
- No destructive migration or production/staging database mutation was run. Real PostgreSQL hydration, concurrent migration, cleanup retention, and multi-instance claim tests remain manual/staging requirements.

## 12. Configuration changes

- Invalid booleans/integers/ports/address lists fail closed.
- Unlimited gasless permits are rejected by default in code, example environment, and documentation.
- Root pnpm overrides patch only `ws` 8.x and `bn.js` 5.x transitive versions.
- Real `.env` values were not edited. The `DEBRIDGE_ENABLED=flase` blocker must be corrected manually.
- No backend credential was renamed to a `VITE_` variable or exposed to the client.

## 13. Files changed by this audit pass

Key implementation files:

- `apps/api/src/config.ts`, `server.ts`, `lib/shutdown.ts`, `lib/http.ts`, `lib/bounded-cache.ts`
- `apps/api/scripts/migrate.ts`, `diagnose-cross-chain.ts`
- `apps/api/src/cross-chain/auth.ts`, `repository.ts`
- `apps/api/src/providers/quotes/zero-x-provider.ts`, `providers/zero-x/gasless-client.ts`
- API provider cache modules for Alchemy, CoinGecko, Moralis, logos, market search, and security
- market-catalog persistence/service files
- `src/App.jsx`, `main.jsx`, `index.css`
- `src/app/AppErrorBoundary.jsx`, `src/features/cross-chain/components/CrossChainRouteCards.jsx`
- `src/features/approvals/hooks/useSwapApproval.js`, `src/features/gas-assist/hooks/useZeroXGaslessSwap.js`, `src/features/gas-assist/hooks/usePrepaidSponsorship.js`, `src/features/cross-chain/hooks/useCrossChainRoutes.js`, `src/features/tokens/hooks/useWalletTokens.js`, `src/features/tokens/hooks/useMarketTokens.js`
- `src/services/swapTransaction.js`, `src/features/swap/services/quotes.js`
- root `package.json`, `pnpm-lock.yaml`, API `.env.example`, and `docs/gas-assist.md`

Regression files added/updated include focused tests for every code-level fix: approval/execution, gasless/sponsorship/cross-chain hooks, market/wallet retention, persistence, HTTP/cache bounds, auth/route capacity, shutdown, error boundary, route ARIA semantics, config, quotes, and gasless permit policy.

The worktree contains many additional pre-existing user changes and untracked files. They were not reset, cleaned, stashed, checked out, committed, or pushed.

## 14. Final tests and checks

| Check | Exact final result |
|---|---|
| Root/full Vitest | 81 files, 753 tests passed, 37.26 s |
| API/full Vitest | 24 files, 332 tests passed, 15.60 s |
| Post-full route ARIA regression | 1 file, 1 test passed |
| API typecheck | `tsc --noEmit` passed |
| Lint | passed; one P3 unused-variable warning |
| Production build | passed; 6,155 modules, 3.58 s |
| React Doctor final | 26/100, 170 raw diagnostics; manually triaged |
| Dependency audit final | 1 high, 2 moderate; down from 2 high, 4 moderate |
| `git diff --check` | passed |
| Secret-name scan | no backend secret variable names in `dist` |
| Secret-value scan | 6 configured credential keys checked; 0 values found in `dist` |

The one build occurred before the final ARIA-only attribute change; that change was covered by its focused jsdom regression test and does not alter imports or build configuration. Per the requested command quota, the build was not repeated.

## 15. Live read-only verification

A finite BNB Smart Chain USDT -> Base USDC exact-input quote was called with a non-user placeholder owner. No server was started.

- First attempt failed closed on `DEBRIDGE_ENABLED=flase` before provider access.
- A process-only `DEBRIDGE_ENABLED=false` override allowed the read-only diagnostic without modifying `.env`.
- Across: eligible but no route on the successful run.
- deBridge: disabled.
- Relay: success, route suffix `c15b8f54`, minimum output `967660` base units.
- Relay normalized quote costs: destination gas `$0.020751`, provider `$0.000099`, app `$0.004496`, swap impact `$0.00144`, sponsored `$0`, route cost `$0.026786`, confidence `quote`.
- Source gas and total stayed `null`, correctly deferred until authenticated preparation.

Authenticated preparation/source-gas estimation was not called live because that flow requires wallet authentication. Mocked tests prove it estimates without signing/submitting and keeps minimum received unchanged.

## 16. Manual wallet behavior not verified

No real AppKit or Pistachio wallet prompt was accepted. The audit did not verify live approval rejection, swap rejection, exact-output provider execution, source-chain switching, cross-chain authentication, prepared gas against a real account balance, deposit rejection, status polling after a real hash, WebAuthn platform quirks, MegaFuel sponsorship, or RPC/provider production credentials.

## 17. Manual verification checklist

Use testnet/local-fork routes where available and cancel/reject wallet prompts. Do not broadcast a mainnet transaction solely for this checklist.

### Same-chain

- [ ] Exact input and exact output produce stable one-request quotes.
- [ ] Cancel approval; verify swap is not submitted and review remains recoverable.
- [ ] Cancel swap; verify state clears without a false success.
- [ ] Verify insufficient sell balance and insufficient native gas are distinct.
- [ ] Let a quote expire; verify confirmation is blocked and refresh preserves valid state.
- [ ] Change settings, disconnect, and switch accounts/chains during refresh.

### Cross-chain

- [ ] Obtain Relay and, where available, Across fallback quotes.
- [ ] Confirm quote-stage route costs and prepared source-gas breakdown.
- [ ] Cancel authentication/chain switch and verify no stale preparation appears.
- [ ] Cancel approval; verify no deposit prompt follows.
- [ ] On a native route, verify no approval prompt appears.
- [ ] Cancel deposit; verify no source hash/status success is reported.
- [ ] Let a route expire before confirm; verify fail-closed behavior.

### Wallet

- [ ] AppKit and Pistachio connect, account switch, chain switch, disconnect, and refresh.
- [ ] Pistachio create/import/restore, lock/unlock, inactivity lock, and rejected signing.
- [ ] Verify transaction review shows chain, recipient, value, and action before rejecting.
- [ ] Verify encrypted backup recovery in an isolated browser profile using non-production test material.

### Tokens/data

- [ ] All Chains and selected-chain wallet/volume/common lists.
- [ ] Exact-address search, duplicate symbols, wallet-owned unverified assets.
- [ ] Partial provider failure retains rows and displays a degraded notice.
- [ ] Backend restart hydrates the last useful catalog; 429/empty refresh does not erase it.
- [ ] Logos exhaust candidates and network badges remain distinct.

### Responsive/accessibility

- [ ] Desktop, short viewport, and mobile widths with long names/addresses/balances.
- [ ] Keyboard-only focus order, dialog trap/Escape/focus return, and selector scroll.
- [ ] Screen-reader labels/live errors and no color-only meaning.
- [ ] Reduced-motion setting and browser zoom.

## 18. Residual risks and recommendation

Recommendation: **not ready** under the current environment. After correcting the invalid boolean, resolving or formally accepting dependency exposure, completing staging database/provider checks, cancellation-based wallet testing, edge security/readiness configuration, and an independent passkey/transaction security audit, the codebase may be reassessed for testnet readiness.

Known residual risks:

- Current real API environment blocks startup by design.
- One high unpatched transitive DoS advisory and two moderate UUID paths remain.
- Provider-supplied dynamic calldata/targets retain supply-chain trust risk.
- Passkey wallet and sponsorship cryptography/policy lack an independent external audit.
- Production CSP/HSTS/frame policy and dependency/RPC/provider credentials are not verifiable from this repository alone.
- Large frontend chunks can affect low-end/mobile startup performance.
- Live signing, approval, deposit, status, database, and production-provider behavior remains unverified.

## 19. Explicit safety confirmation

- No API key was exposed.
- No private key or seed phrase was exposed.
- No automatic signing occurred.
- No approval was automatically accepted.
- No transaction was submitted or broadcast.
- No mainnet transaction was executed.
- No security check was disabled to make tests pass.
- Minimum received was not changed by display-cost calculations.
- No fee was fabricated from input/output price difference.
- All current user work was preserved.
- No destructive git command was used.
- No commit or push occurred.
