# Gas Assist Feature

## Purpose

Owns the direct atomic sponsored-swap behavior and UI. Normal ERC-20 and Permit2 approval remains in `features/approvals`.

## Responsibilities and files

- `hooks/useGasAssistController.js`: composes sponsorship preview and direct atomic sponsorship, derives active quote/status, and synchronizes Buy output.
- `hooks/usePrepaidSponsorship.js`, `useSponsorshipPreview.js`, `useGasAssistConfig.js`, `useMetaMaskMultichainSigner.js`: sponsorship and signing lifecycles.
- `services/`: sponsorship HTTP, raw transaction signing, and MetaMask multichain operations.
- `components/`: banner, status/error, prepaid review, and dialog composition.

## What does not belong here

Normal same-chain allowance reads/approvals, quote-provider ranking, cross-chain routes, token selection, or wallet connector setup.

## Flow

`routing preference -> Gas Assist availability -> sponsorship preview -> explicit fee review -> one EIP-7702 self-transaction -> paymaster submission -> confirmed callback -> balance refresh`.

The old three-transaction payment/approval/swap package, pull-executor fallback,
public 0x Gasless quote/submit routes, and cross-chain sponsorship are not
supported. The fee transfers directly from the user's delegated EOA to the
treasury, while the swap principal remains in that EOA and is spent directly by
the independently quoted router. Both actions share one transaction and revert
together.

## Inputs, outputs, side effects, and errors

The controller accepts the normalized intent, routing/config state, quote refresh identity, output setter, status setter, and confirmed callback. It returns `prepaidSponsorship`, `prepaidRequired`, `executionMode`, active quote/status, and `isGasless`. A leftover `gasAssist` object may still be present for composition; quotes on that 0x path stay disabled. Underlying hooks make feature requests and explicit wallet signatures/transactions only after confirmation. Error codes/messages remain those returned/mapped by existing hooks.

## Logging and security

Preserve existing Gas Assist diagnostic events. Do not expose secrets. Signed raw transactions must remain bound to the reviewed intent.

## Tests and mocked limitations

Tests beside components/hooks/services mock Wagmi, wallet clients, browser state, feature responses, and signatures. They do not prove live provider or wallet behavior.

## Common manual edits and debt

Controller routing/error display: `useGasAssistController.js`; provider HTTP/signature rules: services; dialog copy: components. MetaMask multichain service remains large because transport/session/signing compatibility is tightly coupled. Leftover 0x Gasless client helpers may still exist in source; they are not the production path and public proxy routes for them return 404.
