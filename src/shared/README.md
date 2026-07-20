# Shared Frontend Code

## Purpose

`src/shared` contains frontend code used by more than one feature and with no feature-specific owner.

## Responsibilities

- `components/AppIcons.jsx`: existing decorative application glyphs.
- `logging/swapDiagnostics.js`: stable diagnostic event formatting, redaction, request suffixes, quote/approval/transaction snapshots, and cross-chain visible error mapping.

## What does not belong here

Swap-only models, token catalog rules, approval mechanics, Gas Assist calls, cross-chain route state, or wallet/passkey implementations.

## Public exports and shapes

Diagnostics accept event names plus JSON-like payloads and emit BigInt-safe console objects. Snapshot helpers return limited address/amount/provider/transaction fields. `executionErrorSnapshot` redacts URL queries and long hexadecimal payloads.

## Dependencies and side effects

Icon components have no side effects. `logSwapDiagnostic` writes to `console.debug`, `console.warn`, or `console.error`. Cross-chain message mapping imports the canonical execution error class and user-rejection detector.

## Error handling and security

Diagnostics must never receive secrets, raw signatures, private keys, or provider credentials. Redaction is defense-in-depth, not authorization to log sensitive data.

## Logging events

Event names are supplied by owning features. This directory does not invent or rename them.

## Tests and limitations

Diagnostics are exercised transitively by App and execution tests. Console mocks verify payloads but do not prove production observability or provider behavior.

## Common manual edits and technical debt

Add a shared primitive only when at least two features use it. Several older root `src/services` modules are still shared and can move here in a later path-only cleanup.
