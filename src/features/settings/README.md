# Settings Feature

## Purpose and responsibilities

Owns swap-settings persistence, slippage selection/warnings, and token-visibility toggles. `hooks/useSwapSettings.js` owns persisted settings state; `services/swapSettings.js` validates/normalizes storage; `hooks/useSwapSettingsPopover.js` owns open state/trigger decoration; `hooks/useSettingsDraft.js` owns temporary slippage input state; `components/SwapSettingsPopover.jsx` is a 33-line Radix composition shell.

## What does not belong here

Quote fetching, provider recommendation generation, approval logic, token catalog calls, or transaction execution.

## Inputs, outputs, and side effects

The hook returns `[settings, setSettings]`; the popover receives current settings and `onSettingsChange`. `SlippageSettingsSection` receives the draft API; `SettingsVisibilitySection` receives persisted settings and emits complete next settings objects. Storage reads/writes use existing keys and validated values. Settings changes alter future quote identity through `useSwapController`; presentation components perform no HTTP/RPC/wallet calls.

## Errors, logging, testing, security

Invalid storage values fall back through service normalization. Slippage parsing is pure in `model/settingsValidation.js`; it returns `{valid, empty, bps, error}` and preserves existing messages. Slippage warnings are visible UI, not transaction authorization. No settings-specific diagnostic names were added. Tests mock browser storage, Radix portal, timers, and focus; they do not prove provider recommendations, visual layout, or final on-chain slippage enforcement.

## Flow and manual edits

`SwapToolbar -> SwapSettingsPopover -> useSwapSettingsPopover -> useSettingsDraft -> SlippageSettingsSection/SettingsVisibilitySection -> onSettingsChange -> useSwapSettings -> configured/effective slippage -> useSwapQuote`. Edit UI thresholds/messages in `model/settingsValidation.js`; edit persistence defaults/schema/storage recovery in `services/swapSettings.js`.

## Debug checklist

For an invisible or non-opening popover, inspect `SwapSettingsPopover`, then `useSwapSettingsPopover`, then Radix portal/content classes. For values that do not persist, inspect `useSwapSettings`, then `swapSettings.js` and storage key `pistachioswap:swap-settings:v1`. For rejected custom slippage, inspect `settingsValidation.js` and `customError`/`aria-invalid` in `useSettingsDraft`. For toggles, inspect `SettingsVisibilitySection` callback arguments and the normalized settings object. Escape and focus behavior are owned by Radix plus draft refs; JSDOM cannot prove real browser focus or geometry.

## Technical debt

The largest settings source remains `SwapSettingsPopover.css`; the largest executable settings module is `useSettingsDraft.js` at 141 lines. The settings feature intentionally has no deadline, approval-mode, Gas Assist, fee, or expert controls because none existed in the traced source.
