# Gas Assist Feature

## Purpose

Owns only sponsored/gasless/prepaid swap behavior and UI. Normal ERC-20 and Permit2 approval remains in `features/approvals`.

## Responsibilities and files

- `hooks/useGasAssistController.js`: composes 0x gasless quote state and prepaid fallback, derives active gasless quote/status, synchronizes Buy output, and maps visible quote errors.
- `hooks/useZeroXGaslessSwap.js`, `usePrepaidSponsorship.js`, `useGasAssistConfig.js`, `useMetaMaskMultichainSigner.js`: focused provider/signature/sponsorship lifecycles.
- `services/`: Gas Assist HTTP, sponsorship, raw transaction signing, and MetaMask multichain operations.
- `components/`: banner, approval, status/error, prepaid, and dialog composition.

## What does not belong here

Normal same-chain allowance reads/approvals, quote-provider ranking, cross-chain routes, token selection, or wallet connector setup.

## Flow

`routing preference -> Gas Assist availability -> 0x gasless quote -> prepaid sponsorship -> Gas Assist dialog -> explicit user confirmation -> wallet operation -> confirmed callback -> balance refresh`.

## Inputs, outputs, side effects, and errors

The controller accepts the normalized intent, routing/config state, quote refresh identity, output setter, status setter, and confirmed callback. It returns `gasAssist`, `prepaidSponsorship`, `prepaidRequired`, `executionMode`, active quote/status, and `isGasless`. Underlying hooks make feature requests and explicit wallet signatures/transactions only after confirmation. Error codes/messages remain those returned/mapped by existing hooks.

## Logging and security

Preserve existing Gas Assist and 0x diagnostic events. Do not expose secrets. Gasless signatures and raw transactions must remain bound to the reviewed intent.

## Tests and mocked limitations

Tests beside components/hooks/services mock Wagmi, wallet clients, browser state, 0x, feature responses, and signatures. They do not prove live provider or wallet behavior.

## Common manual edits and debt

Controller routing/error display: `useGasAssistController.js`; provider HTTP/signature rules: services; dialog copy: components. MetaMask multichain service remains large because transport/session/signing compatibility is tightly coupled.
