# Gas Assist Feature

## Purpose

Owns the direct atomic sponsored-swap behavior and UI. Normal ERC-20 and Permit2 approval remains in `features/approvals`.

## Responsibilities and files

- `hooks/useGasAssistController.js`: composes quote state and direct atomic sponsorship, derives active quote/status, synchronizes Buy output, and maps visible quote errors.
- `hooks/useZeroXGaslessSwap.js`, `usePrepaidSponsorship.js`, `useGasAssistConfig.js`, `useMetaMaskMultichainSigner.js`: focused provider/signature/sponsorship lifecycles.
- `services/`: Gas Assist HTTP, sponsorship, raw transaction signing, and MetaMask multichain operations.
- `components/`: banner, approval, status/error, prepaid, and dialog composition.

## What does not belong here

Normal same-chain allowance reads/approvals, quote-provider ranking, cross-chain routes, token selection, or wallet connector setup.

## Flow

`routing preference -> Gas Assist availability -> quote -> explicit fee review -> direct EIP-7702 self-transaction -> paymaster submission -> confirmed callback -> balance refresh`.

The old three-transaction payment/approval/swap package, pull-executor fallback,
and cross-chain sponsorship are not supported. The fee transfers directly from
the user's delegated EOA to the treasury, while the swap principal remains in
that EOA and is spent directly by the independently quoted router. Both actions
share one transaction and revert together.

## Inputs, outputs, side effects, and errors

The controller accepts the normalized intent, routing/config state, quote refresh identity, output setter, status setter, and confirmed callback. It returns `gasAssist`, `prepaidSponsorship`, `prepaidRequired`, `executionMode`, active quote/status, and `isGasless`. Underlying hooks make feature requests and explicit wallet signatures/transactions only after confirmation. Error codes/messages remain those returned/mapped by existing hooks.

## Logging and security

Preserve existing Gas Assist and 0x diagnostic events. Do not expose secrets. Gasless signatures and raw transactions must remain bound to the reviewed intent.

## Tests and mocked limitations

Tests beside components/hooks/services mock Wagmi, wallet clients, browser state, 0x, feature responses, and signatures. They do not prove live provider or wallet behavior.

## Common manual edits and debt

Controller routing/error display: `useGasAssistController.js`; provider HTTP/signature rules: services; dialog copy: components. MetaMask multichain service remains large because transport/session/signing compatibility is tightly coupled.
