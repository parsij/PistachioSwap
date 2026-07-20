# Wallet Components

## WalletConnectionButton

Default-exported stateful account-control composition used by `AppHeader`. Props: `walletState`, `nativeBalance`, `nativeToken`, `walletTokens`, `settings`, `selectedTokens`, `explorerUrl`, and async `onRefetch`. It owns only whether the account dialog is open. No provider request occurs until a child action or supplied refresh callback is invoked.

## WalletAccountButton and WalletAccountDialog

The button shows connect/account state and opens AppKit or the account dialog. The dialog renders assets, receive/send entry points, disconnect, explorer links, and refresh. Preserve accessible labels, Radix portal/focus/Escape behavior, and wallet CSS classes.

## WalletAssetList, SendAssetDialog, ReceiveDialog, TransactionStatusDialog

Asset list formats/filter/groups supplied token data and can copy addresses. Send owns form/validation and invokes Wagmi transaction APIs after explicit confirmation. Receive renders address/QR/copy UI. Transaction status displays pending/success/error state. Services enforce balance, address, classification, and transfer constraints.

## Debug checklist

1. Inspect normalized `useWalletState`.
2. Inspect received balances/tokens/settings.
3. Check dialog open state and portal.
4. Check send form validation and selected token chain.
5. Check Wagmi/public/wallet client mocks or live configuration separately.
6. Run focused files under `src/features/wallet/components/wallet` and `src/App.wallet.test.jsx`.

## Styling, accessibility, and limitations

Primary stylesheet: `components/wallet/wallet.css`. Preserve dialog roles, labels, keyboard focus, disabled state, status announcements, and tested classes. JSDOM does not prove QR scanning, layout, wallet prompts, RPC data, or real transfers.
