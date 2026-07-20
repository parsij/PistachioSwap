# UI Component Index

Paths and tests reflect the post-refactor source tree. Feature component READMEs contain props, state, effects, errors, styling, accessibility, debugging, and limitations.

## Application shell

| Component | Source | Owner | Purpose | State owner | Documentation | Focused test |
| --- | --- | --- | --- | --- | --- | --- |
| `App` | `src/App.jsx` | app | Composition entry point | feature hooks | `src/app/README.md` | `src/app/AppArchitecture.test.js` |
| `AppLayout` | `src/app/AppLayout.jsx` | app | Main shell/CSS variables | none | `src/app/README.md` | `src/app/AppArchitecture.test.js` |
| `AppHeader` | `src/app/AppHeader.jsx` | app | Brand/navigation/wallet controls | wallet children | `src/app/README.md` | `src/App.wallet.test.jsx` |
| `AppErrorBoundary` | `src/app/AppErrorBoundary.jsx` | app | Render fallback | component | `src/app/README.md` | `src/app/AppErrorBoundary.test.jsx` |

## Same-chain swap

| Component | Source | Owner | Purpose | State owner | Documentation | Focused test |
| --- | --- | --- | --- | --- | --- | --- |
| `SwapPage` | `src/features/swap/components/SwapPage.jsx` | swap | Feature composition | controller/hooks | `src/features/swap/components/README.md` | `src/App.wallet.test.jsx` |
| `SwapToolbar` | `src/features/swap/components/SwapToolbar.jsx` | swap | Tabs/settings | input/settings hooks | same | App/settings tests |
| `SwapCard` | `src/features/swap/components/SwapCard.jsx` | swap | Main card composition | controller/hooks | same | App wallet tests |
| `SwapTokenPanel` | `src/features/swap/components/SwapTokenPanel.jsx` | swap | Sell/Buy panel | `useSwapInputs` | same | App wallet tests |
| `SwapAmountInput` | `src/features/swap/components/SwapAmountInput.jsx` | swap | Controlled amount field | `useSwapInputs` | same | App wallet tests |
| `SwapTokenButton` | `src/features/swap/components/SwapTokenButton.jsx` | swap | Token selector trigger | token/input hooks | same | App wallet tests |
| `SwapQuickAmounts` | `src/features/swap/components/SwapQuickAmounts.jsx` | swap | Percentage shortcuts | input hook | same | App wallet tests |
| `SwapDirectionButton` | `src/features/swap/components/SwapDirectionButton.jsx` | swap | Switch assets | input hook | same | App wallet tests |
| `SwapPrimaryAction` | `src/features/swap/components/SwapPrimaryAction.jsx` | swap | Single CTA | eligibility/action hooks | same | App wallet tests |
| `SwapDetails` | `src/features/swap/components/SwapDetails.jsx` | swap | Quote/route details | controller + route hook | same | App/cross-chain tests |
| `SwapInfoTooltip` | `src/features/swap/components/SwapInfoTooltip.jsx` | swap | Portaled help | Radix | same | App wallet tests |
| `TransactionStatus` | `src/features/swap/components/TransactionStatus.jsx` | swap | Visible status | feature hooks | same | App wallet tests |
| `SameChainReviewDialog` | `src/features/swap/components/SameChainReviewDialog.jsx` | swap | Same-chain confirmation | review/execution hooks | same | App wallet tests |

## Approvals

Approvals expose hooks/services rather than a standalone page component. Approval progress and errors render through `SameChainReviewDialog`; see `src/features/approvals/README.md`.

## Tokens

| Component | Source | Owner | Purpose | State owner | Documentation | Focused test |
| --- | --- | --- | --- | --- | --- | --- |
| `TokenSelectorOverlay` | `src/features/tokens/components/TokenSelectorOverlay.jsx` | tokens | Animated selector boundary | catalog controller | `src/features/tokens/components/README.md` | TokenSelector/App tests |
| `TokenSelector` | `src/features/tokens/components/TokenSelector.jsx` | tokens | Search/list/security selection UI | component + catalog controller | same | `TokenSelector.test.jsx` |
| `TokenSelectorSections` | `src/features/tokens/components/TokenSelectorSections.jsx` | tokens | Wallet/market/recent section markup | `useTokenSelectorState` | `src/features/tokens/components/README.md` | `TokenSelector.test.jsx` |
| `TokenSearchResults` | same | tokens | Loading/error/empty/search rows | `useTokenSelectorState` | same | `TokenSelector.test.jsx` |
| `TokenSelectorPrimitives` | `src/features/tokens/components/TokenSelectorPrimitives.jsx` | tokens | Chain, row, heading, skeleton primitives | local chain state / parent | same | `TokenSelector.test.jsx` |
| `TokenSelectorIcons` | `src/features/tokens/components/TokenSelectorIcons.jsx` | tokens | Selector SVG icons | none | same | composed selector tests |
| `TokenIcon` / `ChainIcon` | `src/features/tokens/components/TokenIcon.jsx` | tokens | Image fallback | component/cache | same | token icon/cache tests |

## Settings

| Component | Source | Owner | Purpose | State owner | Documentation | Focused test |
| --- | --- | --- | --- | --- | --- | --- |
| `SwapSettingsPopover` | `src/features/settings/components/SwapSettingsPopover.jsx` | settings | Slippage/visibility settings | component + settings hook | `src/features/settings/components/README.md` | `SwapSettingsPopover.test.jsx` |
| `SlippageSettingsSection` | `src/features/settings/components/SlippageSettingsSection.jsx` | settings | Slippage editor and warning | `useSettingsDraft` | `src/features/settings/README.md` | `SwapSettingsPopover.test.jsx` |
| `SettingsVisibilitySection` | `src/features/settings/components/SettingsVisibilitySection.jsx` | settings | Token visibility toggles | persisted settings hook | `src/features/settings/README.md` | `SwapSettingsPopover.test.jsx` |
| `SettingsToggleRow` / `InfoTooltip` | same directory | settings | Toggle/help primitives | Radix/component | same | popover test |

## Wallet

| Component | Source | Owner | Purpose | State owner | Documentation | Focused test |
| --- | --- | --- | --- | --- | --- | --- |
| `WalletConnectionButton` | `src/features/wallet/components/WalletConnectionButton.jsx` | wallet | Account control/dialog | component + wallet hook | `src/features/wallet/components/README.md` | App wallet tests |
| `WalletAccountButton` / `WalletAccountDialog` | `src/features/wallet/components/wallet/` | wallet | Account/modal controls | components/Wagmi | same | wallet component tests |
| `WalletAssetList` | same | wallet | Wallet asset groups | component | same | `WalletAssetList.test.jsx` |
| `SendAssetDialog` / `ReceiveDialog` | same | wallet | Transfer/receive UI | components/Wagmi | same | focused dialog tests |
| `TransactionStatusDialog` | same | wallet | Transfer status | parent/component | same | send dialog test |

## Gas Assist

| Component | Source | Owner | Purpose | State owner | Documentation | Focused test |
| --- | --- | --- | --- | --- | --- | --- |
| `GasAssistBanner` | `src/features/gas-assist/components/GasAssistBanner.jsx` | Gas Assist | Active-mode notice | controller | `src/features/gas-assist/components/README.md` | banner test |
| `GasAssistDialogs` | same directory | Gas Assist | Modal composition | Gas Assist hooks | same | App/Gas Assist tests |
| `GasAssistApprovalDialog` | same | Gas Assist | Signature/approval review | Gas Assist hook + component | same | approval dialog test |
| `GasAssistPrepaymentDialog` | same | Gas Assist | Sponsorship review | sponsorship hook + component | same | prepayment test |
| `GasAssistStatus` / `GasAssistError` | same | Gas Assist | State/error presentation | owning hook | same | dialog tests |

## Cross-chain

| Component | Source | Owner | Purpose | State owner | Documentation | Focused test |
| --- | --- | --- | --- | --- | --- | --- |
| `CrossChainRouteCards` | `src/features/cross-chain/components/CrossChainRouteCards.jsx` | cross-chain | Route comparison/selection | route hook | `src/features/cross-chain/components/README.md` | route-card test |
| `CrossChainReviewDialog` | same directory | cross-chain | Prepared-route confirmation | cross-chain controller | same | App wallet tests |
| `ChainSelector` | same directory | cross-chain | Curated chain choice | parent | same | composed tests |

## Passkey

| Component | Source | Owner | Purpose | State owner | Documentation | Focused test |
| --- | --- | --- | --- | --- | --- | --- |
| `PistachioWalletController` | `src/features/passkey/components/PistachioWalletController.jsx` | passkey | Vault/session/signing UI | manager + component | `src/features/passkey/components/README.md` | controller test |
| `PistachioWalletButton` | same | passkey | Header entry | manager/controller | same | controller/App tests |
| `PasskeyVaultTestPanel` | same directory | passkey | DEV diagnostics | component/services | same | passkey service tests |

## Shared components

| Component | Source | Owner | Purpose | State owner | Documentation | Focused test |
| --- | --- | --- | --- | --- | --- | --- |
| Application icon exports | `src/shared/components/AppIcons.jsx` | shared | Decorative glyphs | none | `src/shared/README.md` | composed tests |
# Wallet UI

| Component | Source | Owner | Focused test |
| --- | --- | --- | --- |
| PistachioWalletController | `src/features/passkey/components/PistachioWalletController.jsx` | passkey/wallet shell | `src/features/passkey/components/PistachioWalletController.test.jsx` |
| Wallet setup and management screens | `src/features/passkey/components/PistachioWalletScreens.jsx` | passkey/wallet UI | `src/features/passkey/components/PistachioWalletController.test.jsx` |
