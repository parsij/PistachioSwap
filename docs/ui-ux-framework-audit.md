# PistachioSwap UI/UX framework audit

Scope: current marketing pages, swap application, token/settings surfaces, Reown wallet UI, and Pistachio Wallet. This audit maps every supplied rule to an explicit result. Travel-card examples are treated as examples, not invented product requirements.

Status key: **PASS** already satisfied, **APPLIED** corrected by this change, **N/A** not represented by this product, **PARTIAL** deliberately bounded where applying the rule literally would damage accessibility or product behavior.

## 1. Signifiers and affordances

- **Grouped items use containers — PASS.** Swap sell/buy panels, quote details, settings sections, wallet dialogs, stats, guide cards, token rows, and Gas Assist disclosures use shared surfaces, borders, or card containers.
- **Single selected/toggleable items show selection — APPLIED.** `aria-current`, `aria-selected`, `aria-pressed`, Radix checked/on states now receive a shared selected surface and border treatment.
- **Inactive elements are grayed out — APPLIED.** Native `disabled`, `aria-disabled`, and `data-disabled` controls now receive reduced saturation/opacity and a not-allowed cursor.
- **Operation is understandable without written instructions — PASS.** Token pickers, swap direction, amount fields, settings switches, wallet actions, send/receive, and primary swap eligibility are represented by conventional controls and labels. Help text remains supplemental rather than the only signifier.
- **Press states, active navigation, hover, tooltips — APPLIED/PASS.** Global hover and pressed feedback is added. Active/selected state is standardized. Existing swap/settings info tooltips remain the explanatory mechanism for unfamiliar controls.

## 2. Visual hierarchy and contrast

- **Cards must not resemble spreadsheets — PASS.** Cards use grouped surfaces, asymmetric content hierarchy, icons, headings, and muted metadata rather than dense ruled tables.
- **Images add scanning/color — PASS.** Token icons and network logos are used throughout swap/token/network surfaces and the marketing network ticker.
- **Most important item large/bold/top — PASS.** Marketing hero and swap amount/primary CTA already lead their surfaces. The app type layer caps dense product text at 24px while preserving amount prominence.
- **Less-important details smaller/below — APPLIED/PASS.** Notes, captions, status, metadata, warnings, and hints are normalized to the 12px tier.
- **Price at top-right and blue — N/A.** PistachioSwap has no ride, product-listing, or fare card with a standalone price. Applying this would falsely reinterpret token amounts/quotes as a commerce price card.
- **From/to icons with connecting line — N/A.** There is no pickup/drop-off location model. Swap direction is already represented by token panels and a direction control.

## 3. Grid systems and whitespace

- **Do not force a universal 12-column grid — PASS.** Existing marketing and application layouts remain purpose-built and content-driven.
- **8-column tablet / 4-column mobile for repeating content — APPLIED.** Marketing stats/guide/feature/network grids receive 8-column tablet and 4-column mobile tracks. Tablet cards span four columns and mobile cards span the full row.
- **Whitespace over excessive grid rigidity — PASS.** Existing section shells and card spacing remain fluid; the new layer does not impose a desktop column grid.
- **Distinct items separated, related items grouped more tightly — PASS.** Existing sections use larger outer spacing with tighter internal gaps. New control sizing uses 4-point increments.
- **4-point grid for layout spacing/sizing — PARTIAL.** New control heights, padding, radii, icon dimensions, gaps introduced by this layer are multiples of 4. Legacy CSS still contains 1px borders, optical offsets, and historical dimensions such as 14/18/22px radii. Those are not blindly rounded because doing so globally would alter component geometry and accessibility. New framework values are constrained to the 4-point layout grid.

## 4. Typography

- **One font family — APPLIED.** Ubuntu is loaded at both application and public marketing/guide entrypoints and enforced across rendered UI, including controls and code/address text.
- **Header tracking -2% to -3%, line-height 110% to 120% — APPLIED.** Headings/titles use `letter-spacing: -0.025em` and `line-height: 1.15`.
- **No more than six website font sizes — APPLIED.** Marketing uses exactly 12/14/16/20/24/48px.
- **Dashboard text normally <=24px — APPLIED.** The swap application uses the compact 12/14/16/20/24px subset; swap/send amount inputs cap at 24px.

## 5. Colors

- **One primary brand color — PASS.** Pistachio green remains the brand accent.
- **Brand ramp for subtle backgrounds/text — PASS/APPLIED.** Existing green-tinted surfaces remain; selected states now use `color-mix()` to create a restrained action surface rather than a flat saturated fill.
- **Semantic colors have purpose — APPLIED.** Blue is the primary action/focus color, red is danger/error, yellow is warning, and green is success/brand. Primary actionable controls move to blue while green remains recognizable Pistachio branding.

## 6. Dark mode

- **Lower light-border contrast — APPLIED.** Major cards/dialogs use a 10% white border token.
- **Depth via lighter cards than page background — APPLIED.** App background is `#191b19`; primary card/dialog surface is `#242724`; elevated layers use `#2c302c` where applicable.
- **Dim chip backgrounds / brighter text — PASS.** Existing chips and badges already use restrained dark fills with higher-contrast text; selected state backgrounds are kept at a low action-color mix.
- **Use deep colors, not only navy/gray — PASS/APPLIED.** Pistachio green is retained throughout semantic and brand surfaces; danger/warning/action ramps provide red/yellow/blue accents without turning neutral reading surfaces into saturated blocks.

## 7. Shadows

- **Light-mode shadow softness — N/A.** The production experience is dark-first.
- **Shadow strength follows elevation — APPLIED.** Cards use a softer `0 12px 32px / 18%` shadow while dialogs/popovers use `0 24px 64px / 34%`.
- **Inner/outer tactile button shadow — OPTIONAL, NOT FORCED.** The framework says these can be used, not that they are mandatory. State feedback is handled by color/filter/press behavior instead.
- **Shadow must not dominate — APPLIED.** Card shadows are intentionally lower-opacity than overlays.

## 8. Icons and buttons

- **Icon size matches adjacent text line-height — APPLIED.** Standard text controls use a 20px line box and direct SVG children are normalized to 20x20px. Network ticker imagery is normalized to 24x24px.
- **Button horizontal padding is double vertical padding — APPLIED.** Standard primary app controls use 12px vertical / 24px horizontal; marketing standard buttons use 8/16 and large buttons use 12/24.
- **Ghost buttons for sidebar/navigation links — PASS.** Existing ghost/transparent controls remain for secondary navigation and icon actions.
- **Primary + secondary CTAs side-by-side — PASS.** Marketing hero already pairs `Open wallet` with a ghost `How Gas Assist works` CTA.

## 9. Interactive states and responses

- **Every user action gets a response — APPLIED/PASS.** Hover/press/focus states are standardized. Existing swap/wallet transaction state and status messaging remain intact.
- **Every button has default, hover, active, disabled — APPLIED.** Shared rules now guarantee all four for native buttons, role-buttons, and button-styled anchors. Component-specific styling can still refine the state.
- **Inputs have focus/error/warning states — APPLIED.** Focus-visible uses action blue; `aria-invalid=true` uses red; `data-warning=true` uses yellow.
- **Loading spinner/data feedback/success message — APPLIED/PASS.** `aria-busy=true` buttons receive an explicit 16px spinner. Existing swap busy labels/status, wallet transaction states, and copy success announcements remain.
- **Micro-animation on scroll/swipe — PASS.** Marketing reveal/ticker motion and app motion interactions already exist, with reduced-motion handling preserved.

## 10. Micro-interactions

- **Explicit confirmation beyond hover/click — PASS.** Wallet copy actions already expose `Copied` state/status announcements; transaction flows surface status/success/failure. The new framework adds busy motion rather than treating a click state as completion feedback.

## 11. Overlays

- **No plain text directly over an image — PASS.** Current hero/guide content does not place readable copy directly over photography.
- **No flat full-screen dark overlay — APPLIED.** Wallet/modal/mobile backdrops use a dark directional gradient plus blur rather than a uniform black sheet.
- **Image overlay gradient — N/A.** There are no text-over-photo hero/image overlays to repair.
- **Progressive blur over gradient — APPLIED where overlays exist.** UI backdrops use an 8px blur with slight saturation reduction. An image-specific progressive mask is unnecessary until a text-over-image composition exists.

## Implementation files

- `src/designFramework.css`: application states, hierarchy, semantic colors, dark depth, shadows, button/icon rules, overlays.
- `src/designTypeScale.css`: strict compact application type scale.
- `landing/designFramework.css`: marketing states, grid behavior, colors, shadows, controls, overlay treatment.
- `landing/designTypeScale.css`: strict six-size marketing type scale.
- `landing/designResponsiveFixes.css`: responsive hierarchy and 8/4-column card spans.
- `landing/design-entry.js`: Ubuntu plus all static design layers for public pages.
- `src/web3/publicGuideRoutes.js`: injects the static design entry only into pages using the marketing stylesheet.
- `src/main.jsx`: Ubuntu plus the application framework layers.
- `src/app/designFramework.test.js`: regression coverage for design-entry scope, font, type, state, and semantic-color rules.

## Deliberate boundaries

The 4-point rule is treated as a layout grid, not a demand to make 1px borders or 14px typography mathematically divisible by four. The travel-card price/location examples are not applied to unrelated swap data. These are the two places where literal application would make the interface worse rather than more consistent.
