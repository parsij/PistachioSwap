# Gas Assist Components

## GasAssistBanner

Presentation-only notice shown inside the swap card when gasless execution is active. Props are `quote`, `sellToken`, and `buyToken`; it formats existing fee/minimum data and has no callbacks or direct side effects. Preserve `gas-assist-banner`, visible 0x attribution, fee copy, and accessible aside label. Test: `GasAssistBanner.test.jsx`.

## GasAssistApprovalDialog

Stateful Radix approval/signature review surface. It receives `dialog`, `buyToken`, `token`, `amount`, `onClose`, and async `onConfirm`. It renders idle/pending/error/success states from the hook and invokes confirmation only after user action. Portal/focus/Escape behavior is Radix-owned; wallet/signature work belongs to the callback. Inspect dialog state, Gas Assist hook, error code, and focused test first.

## GasAssistPrepaymentDialog

Radix review surface for prepaid sponsorship orders. Props are `sponsorship`, `sellToken`, and `buyToken`; internal display state tracks confirmation inputs while the hook owns order/network/wallet state. Explicit confirm may perform sponsorship/wallet operations. Preserve all current labels/classes and test with `GasAssistPrepaymentDialog.test.jsx`.

## GasAssistDialogs, GasAssistStatus, and GasAssistError

`GasAssistDialogs` composes both modal surfaces from grouped view models. Status/error components present hook state and safe messages. They make no provider calls directly.

## Styling, accessibility, errors, and limitations

Primary stylesheet: `gasAssist.css`. Preserve Radix portal layers, close labels, roles/status text, disabled states, and CSS classes. Error codes/messages originate in Gas Assist hooks/services; retry requirements depend on quote/order expiry and wallet state. JSDOM tests do not prove stacking, real signatures, provider behavior, or fund movement.
