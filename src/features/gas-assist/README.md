# Gas Assist Feature

## Purpose

Owns the atomic sponsored-swap behavior and UI. Normal ERC-20 and Permit2 approval remains in `features/approvals`.

## Responsibilities and files

- `hooks/useGasAssistController.js`: composes atomic sponsorship state, derives the active quote/status, synchronizes Buy output, and maps visible errors.
- `hooks/usePrepaidSponsorship.js`, `hooks/useSponsorshipPreview.js`, and `hooks/useSponsorshipConfig.js`: atomic sponsorship lifecycle and configuration.
- `services/prepaidSponsorship.js`: sponsorship HTTP boundary.
- `components/`: review, status/error, prepaid, and dialog composition.

`useZeroXGaslessSwap.js` and `useGasAssistConfig.js` are inert compatibility shims for older test/view contracts. Production routing does not use 0x Gasless execution, and the shims must not acquire provider, signing, submission, or polling behavior.

## What does not belong here

Normal same-chain allowance reads/approvals, quote-provider ranking, cross-chain routes, token selection, or wallet connector setup.

## Flow

`routing preference -> atomic sponsorship availability -> preview -> explicit fee review -> EIP-7702 self-transaction -> paymaster submission -> confirmed callback -> balance refresh`.

The retired 0x Gasless flow and the old three-transaction payment/approval/swap package are not supported. The fee transfers directly from the user's delegated EOA to the treasury, while the swap principal remains in that EOA and is spent directly by the independently quoted router. Both actions share one transaction and revert together.

## Inputs, outputs, side effects, and errors

The controller accepts the normalized intent, routing state, output setter, and confirmed callback. It returns atomic sponsorship state, the active execution mode, active quote/status, and compatibility view-model fields. Sponsorship hooks make backend requests and explicit wallet operations only through the reviewed atomic flow.

## Logging and security

Do not expose secrets or full calldata in customer-facing errors. Preserve stable Gas Assist diagnostics needed for debugging. Atomic execution must remain bound to the reviewed wallet, tokens, amounts, fee, router, calldata, deadline, and sponsorship policy.

## Tests and mocked limitations

Tests mock wallet clients, browser state, feature responses, and sponsorship operations. They do not prove live provider, paymaster, or wallet behavior.

## Common manual edits and debt

Controller routing/error display: `useGasAssistController.js`; sponsorship HTTP: `services/prepaidSponsorship.js`; review/dialog copy: components. Remove the two compatibility shims once the remaining legacy test/view-model names are migrated.
