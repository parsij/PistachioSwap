# Wallet UI Feature

## Purpose and responsibilities

Owns connected-account presentation and normalized AppKit/Wagmi wallet state. `hooks/useWalletState.js` distinguishes connected address, current chain, and expected-chain correctness. `components/WalletConnectionButton.jsx` composes the account button/dialog and wallet asset/send/receive surfaces under `components/wallet`.

## What does not belong here

Passkey vault/connector implementation, swap approval, quote logic, Gas Assist, or cross-chain route algorithms.

## Inputs, outputs, side effects, and errors

The wallet-state hook returns normalized connection/address/chain/correct-network state. The connection button receives wallet/native/token/settings/selected-token/explorer data and an async refresh callback. Components can open AppKit/account/send/receive dialogs, read balances, and on explicit send submit a wallet transaction through their dedicated existing logic.

## Security

Connected and unlocked are separate concepts. Never infer authorization from UI connection alone. Send validation and risky-token warnings remain in their services/components. Do not log secrets or signing payloads.

## Tests and mocked limitations

Focused component tests mock Wagmi/Viem, wallet clients, browser APIs, and transactions. They do not prove a real wallet prompt, RPC balance, transaction propagation, or explorer result.

## Common edits and debt

Connection normalization: hook; account header/modal: wallet components; send/receive flows: subcomponents. Passkey-specific controls live in `features/passkey`.
