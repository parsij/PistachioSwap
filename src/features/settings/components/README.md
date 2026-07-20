# SwapSettingsPopover

## Purpose and ownership

The default-exported `SwapSettingsPopover.jsx` is the 33-line Radix composition surface rendered by `SwapToolbar`. `useSwapSettingsPopover` owns open/trigger behavior, `useSettingsDraft` owns temporary slippage text and focus refs, `SlippageSettingsSection` renders the editor, and `SettingsVisibilitySection` renders persisted token-visibility toggles.

## Props

| Prop | Type | Required | Behavior |
| --- | --- | --- | --- |
| `settings` | object | yes | Current persisted values. |
| `onSettingsChange` | function | yes | Called with validated next settings; parent persists and requotes. |
| `children` | React element | yes | Cloned trigger; `aria-expanded`/state are synchronized. |

## States, effects, errors, and debugging

Renders auto/custom slippage, high/very-high warnings, token visibility toggles, open/closed states, and invalid input handling. Valid custom input is persisted immediately through the callback; invalid/empty custom input falls back to Auto on close. It uses Radix focus/portal behavior and performs no network/wallet work. Debug received settings, `draftMode`, `customInput`, warning severity, Radix `data-state`, persisted hook state, then run its focused test.

## Styling and accessibility

`SwapSettingsPopover.css`; important trigger/popover/toggle classes are test-coupled. Radix supplies popover keyboard/focus behavior, triggers have existing accessible labels, and warning text remains visible.

## Limitations

JSDOM does not prove placement, stacking, or real browser focus. Storage parsing/writing remains in `services/swapSettings.js`; pure input validation remains in `model/settingsValidation.js`.
