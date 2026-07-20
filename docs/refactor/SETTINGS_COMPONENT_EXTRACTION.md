# Settings Component Extraction

## Current ownership

`SwapSettingsPopover.jsx` currently owns the Radix popover root/portal, trigger
cloning, open state, draft slippage mode/input, slippage parsing and severity,
custom-input focus/keyboard behavior, immediate settings persistence through
`onSettingsChange`, recent validation messages, and the two token-visibility
toggle rows. `useSwapSettings` owns persisted normalized settings and
`swapSettings.js` owns the storage key, defaults, normalization, read, and
write behavior.

The current source does not contain transaction deadline, approval-mode,
Gas Assist, fee, or expert settings. Those responsibilities are intentionally
not invented or moved.

## Proposed ownership

| Responsibility | Final owner |
| --- | --- |
| Popover root, trigger, portal, focus, Escape | `SwapSettingsPopover.jsx`, `useSwapSettingsPopover.js` |
| Trigger value/severity decoration | `SwapSettingsTrigger.jsx` |
| Slippage draft and callbacks | `useSettingsDraft.js` |
| Slippage parsing/severity/warnings | `model/settingsValidation.js` |
| Slippage markup | `SlippageSettingsSection.jsx` |
| Visibility toggles | `SettingsVisibilitySection.jsx` |
| Generic toggle and tooltip primitives | Existing `SettingsToggleRow.jsx`, `InfoTooltip.jsx` |
| Persistent schema/defaults/read/write | Existing `services/swapSettings.js` |

## State and side effects

The persisted parent `settings` object remains authoritative. The new draft hook
owns only `draftMode`, `customInput`, `customError`, and the two input refs;
valid custom values continue to call `onSettingsChange` immediately and closing
the popover preserves the current auto-fallback behavior. The popover hook owns
`open` and synchronizes drafts only while closed. Components remain free of
localStorage, quote, wallet, RPC, or provider calls.

## Diagnostics, accessibility, and tests

No settings diagnostic event names are emitted by the current implementation;
none are added. Radix `Popover.Root`, `Trigger`, `Portal`, `Content`, existing
focus prevention, Escape behavior, labels, roles, and CSS classes remain intact.
Existing coverage is `src/features/settings/components/SwapSettingsPopover.test.jsx`;
focused model/hook tests cover parsing, draft transitions, and persistence
boundaries. JSDOM does not prove real portal geometry, visual focus, or layout.

## Safe move order

1. Extract pure slippage validation/display functions.
2. Extract draft/open state into `useSettingsDraft` and `useSwapSettingsPopover`.
3. Extract slippage and visibility presentation sections.
4. Keep the existing integration test and run settings/App tests, lint, build,
   and `git diff --check`.
