import {
    cloneElement,
    isValidElement,
    useEffect,
    useRef,
    useState,
} from 'react'

import * as Popover from '@radix-ui/react-popover'

import InfoTooltip from './InfoTooltip.jsx'
import SettingsToggleRow from './SettingsToggleRow.jsx'

import './SwapSettingsPopover.css'

const AUTO_SLIPPAGE_BPS = 250

// More than 5.5% is high.
const HIGH_SLIPPAGE_BPS = 550

// More than 22% is very high.
const VERY_HIGH_SLIPPAGE_BPS = 2200

// Custom slippage may go up to 100%.
const MAX_SLIPPAGE_BPS = 10_000
const MIN_SLIPPAGE_BPS = 1

function formatSlippageBps(bps) {
    if (
        !Number.isInteger(bps) ||
        bps < 0
    ) {
        return '0%'
    }

    const whole = Math.floor(bps / 100)
    const fraction = bps % 100

    if (fraction === 0) {
        return `${whole}%`
    }

    const formattedFraction = String(fraction)
        .padStart(2, '0')
        .replace(/0+$/, '')

    return `${whole}.${formattedFraction}%`
}

function formatSlippageInput(bps) {
    return formatSlippageBps(bps)
        .replace('%', '')
}

function parseSlippageInput(value) {
    const normalized = String(value).trim()

    if (normalized === '') {
        return {
            valid: false,
            empty: true,
            bps: null,
            error: null,
        }
    }

    if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) {
        return {
            valid: false,
            empty: false,
            bps: null,
            error: 'Enter a valid percentage.',
        }
    }

    const [
        wholePart,
        fractionPart = '',
    ] = normalized.split('.')

    const wholeBps =
        BigInt(wholePart) * 100n

    const fractionBps = BigInt(
        fractionPart.padEnd(2, '0'),
    )

    const totalBps =
        wholeBps + fractionBps

    if (
        totalBps <
        BigInt(MIN_SLIPPAGE_BPS)
    ) {
        return {
            valid: false,
            empty: false,
            bps: null,
            error:
                'Slippage must be at least 0.01%.',
        }
    }

    if (
        totalBps >
        BigInt(MAX_SLIPPAGE_BPS)
    ) {
        return {
            valid: false,
            empty: false,
            bps: null,
            error:
                'Slippage cannot exceed 100%.',
        }
    }

    return {
        valid: true,
        empty: false,
        bps: Number(totalBps),
        error: null,
    }
}

function getSlippageSeverity(bps) {
    if (!Number.isInteger(bps)) {
        return 'normal'
    }

    if (bps > VERY_HIGH_SLIPPAGE_BPS) {
        return 'very-high'
    }

    if (bps > HIGH_SLIPPAGE_BPS) {
        return 'high'
    }

    return 'normal'
}

function getWarningLabel(severity) {
    if (severity === 'very-high') {
        return 'Very high slippage'
    }

    if (severity === 'high') {
        return 'High slippage'
    }

    return null
}

function WarningIcon() {
    return (
        <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
        >
            <path
                d="M8.63 2.63a1.58 1.58 0 0 1 2.74 0l7.08 12.27a1.58 1.58 0 0 1-1.37 2.37H2.92a1.58 1.58 0 0 1-1.37-2.37L8.63 2.63Z"
                fill="currentColor"
            />

            <path
                d="M10 6.3v5.1"
                fill="none"
                stroke="#191919"
                strokeLinecap="round"
                strokeWidth="1.8"
            />

            <circle
                cx="10"
                cy="14.1"
                r="1"
                fill="#191919"
            />
        </svg>
    )
}

function createSettingsTrigger({
                                   children,
                                   showValue,
                                   formattedValue,
                                   severity,
                               }) {
    if (
        !showValue ||
        !isValidElement(children)
    ) {
        return children
    }

    const existingClassName =
        children.props.className ?? ''

    return cloneElement(children, {
        className: [
            existingClassName,
            'settings-trigger-with-value',
            `settings-trigger-${severity}`,
        ]
            .filter(Boolean)
            .join(' '),

        'aria-label':
            `Swap settings, custom slippage ${formattedValue}`,

        children: (
            <>
                <span className="settings-trigger-value">
                    {formattedValue}
                </span>

                <span className="settings-trigger-icon">
                    {children.props.children}
                </span>
            </>
        ),
    })
}

export default function SwapSettingsPopover({
                                                children,
                                                settings,
                                                onSettingsChange,
                                            }) {
    const autoButtonRef = useRef(null)
    const customInputRef = useRef(null)

    const [open, setOpen] =
        useState(false)

    /*
     * Local draft mode is deliberately separate from the
     * persisted parent setting.
     *
     * That makes warning colors update immediately while
     * typing, even if the parent updates asynchronously.
     */
    const [draftMode, setDraftMode] =
        useState(settings.slippageMode)

    const [customInput, setCustomInput] =
        useState(() => {
            if (
                settings.slippageMode ===
                'custom' &&
                Number.isInteger(
                    settings.customSlippageBps,
                )
            ) {
                return formatSlippageInput(
                    settings.customSlippageBps,
                )
            }

            return formatSlippageInput(
                AUTO_SLIPPAGE_BPS,
            )
        })

    const [customError, setCustomError] =
        useState(null)

    const isAuto =
        draftMode === 'auto'

    const isCustom =
        draftMode === 'custom'

    /*
     * Warning state comes directly from the value being
     * typed, not from the potentially delayed parent state.
     */
    const parsedDraft =
        parseSlippageInput(customInput)

    const draftCustomBps =
        parsedDraft.valid
            ? parsedDraft.bps
            : null

    const activeSeverity =
        isCustom
            ? getSlippageSeverity(
                draftCustomBps,
            )
            : 'normal'

    const warningLabel =
        getWarningLabel(activeSeverity)

    const committedCustomBps =
        settings.slippageMode === 'custom' &&
        Number.isInteger(
            settings.customSlippageBps,
        )
            ? settings.customSlippageBps
            : null

    const committedSeverity =
        getSlippageSeverity(
            committedCustomBps,
        )

    /*
     * Match the video: the percentage appears beside the
     * gear after the settings popover closes.
     */
    const showTriggerValue =
        !open &&
        committedCustomBps !== null

    const formattedTriggerValue =
        committedCustomBps === null
            ? ''
            : formatSlippageBps(
                committedCustomBps,
            )

    const settingsTrigger =
        createSettingsTrigger({
            children,
            showValue: showTriggerValue,
            formattedValue:
            formattedTriggerValue,
            severity:
            committedSeverity,
        })

    /*
     * Synchronize the local draft only while the popover is
     * closed. Never overwrite what the user is actively typing.
     */
    useEffect(() => {
        if (open) {
            return
        }

        setDraftMode(
            settings.slippageMode,
        )

        if (
            settings.slippageMode ===
            'custom' &&
            Number.isInteger(
                settings.customSlippageBps,
            )
        ) {
            setCustomInput(
                formatSlippageInput(
                    settings.customSlippageBps,
                ),
            )
        } else {
            setCustomInput(
                formatSlippageInput(
                    AUTO_SLIPPAGE_BPS,
                ),
            )
        }

        setCustomError(null)
    }, [
        open,
        settings.customSlippageBps,
        settings.slippageMode,
    ])

    function selectAuto() {
        setDraftMode('auto')
        setCustomError(null)

        setCustomInput(
            formatSlippageInput(
                AUTO_SLIPPAGE_BPS,
            ),
        )

        onSettingsChange({
            ...settings,
            slippageMode: 'auto',
        })
    }

    function beginCustomEditing() {
        if (isCustom) {
            customInputRef.current?.focus()
            return
        }

        /*
         * Match the recording: clicking the manual side makes
         * the field completely empty so typing can begin.
         */
        setDraftMode('custom')
        setCustomInput('')
        setCustomError(null)

        window.requestAnimationFrame(() => {
            customInputRef.current?.focus()
        })
    }

    function handleCustomPointerDown(event) {
        if (!isCustom) {
            event.preventDefault()
            beginCustomEditing()
        }
    }

    function handleCustomFocus() {
        if (!isCustom) {
            beginCustomEditing()
        }
    }

    function updateCustom(event) {
        const nextValue =
            event.target.value

        /*
         * Allow zero to 100 with up to two decimals.
         * Values above 100 remain visible long enough to show
         * the validation message.
         */
        if (
            !/^\d*(?:\.\d{0,2})?$/.test(
                nextValue,
            )
        ) {
            return
        }

        setDraftMode('custom')
        setCustomInput(nextValue)

        const parsed =
            parseSlippageInput(nextValue)

        if (parsed.empty) {
            setCustomError(null)
            return
        }

        if (!parsed.valid) {
            setCustomError(parsed.error)
            return
        }

        setCustomError(null)

        /*
         * Commit every valid value immediately. This includes
         * 50%, 60% and 100%.
         */
        onSettingsChange({
            ...settings,
            slippageMode: 'custom',
            customSlippageBps:
            parsed.bps,
        })
    }

    function handleCustomBlur() {
        const parsed =
            parseSlippageInput(
                customInput,
            )

        if (parsed.empty) {
            setCustomError(null)
            return
        }

        if (!parsed.valid) {
            setCustomError(parsed.error)
            return
        }

        setCustomInput(
            formatSlippageInput(
                parsed.bps,
            ),
        )

        setCustomError(null)
    }

    function handleCustomKeyDown(event) {
        if (event.key === 'Enter') {
            event.preventDefault()
            customInputRef.current?.blur()
        }

        if (event.key === 'Escape') {
            event.preventDefault()

            if (
                Number.isInteger(
                    settings.customSlippageBps,
                )
            ) {
                setCustomInput(
                    formatSlippageInput(
                        settings.customSlippageBps,
                    ),
                )

                setDraftMode('custom')
            } else {
                setDraftMode('auto')

                setCustomInput(
                    formatSlippageInput(
                        AUTO_SLIPPAGE_BPS,
                    ),
                )
            }

            setCustomError(null)
            customInputRef.current?.blur()
        }
    }

    function handleOpenChange(nextOpen) {
        if (nextOpen) {
            /*
             * Start each opening from the current committed
             * application setting.
             */
            setDraftMode(
                settings.slippageMode,
            )

            if (
                settings.slippageMode ===
                'custom' &&
                Number.isInteger(
                    settings.customSlippageBps,
                )
            ) {
                setCustomInput(
                    formatSlippageInput(
                        settings.customSlippageBps,
                    ),
                )
            } else {
                setCustomInput(
                    formatSlippageInput(
                        AUTO_SLIPPAGE_BPS,
                    ),
                )
            }

            setCustomError(null)
            setOpen(true)
            return
        }

        const parsed =
            parseSlippageInput(
                customInput,
            )

        /*
         * Closing with a valid custom value commits it.
         */
        if (
            isCustom &&
            parsed.valid
        ) {
            onSettingsChange({
                ...settings,
                slippageMode: 'custom',
                customSlippageBps:
                parsed.bps,
            })
        }

        /*
         * Closing with an empty or invalid custom value safely
         * returns to Auto.
         */
        if (
            isCustom &&
            !parsed.valid
        ) {
            onSettingsChange({
                ...settings,
                slippageMode: 'auto',
            })

            setDraftMode('auto')

            setCustomInput(
                formatSlippageInput(
                    AUTO_SLIPPAGE_BPS,
                ),
            )

            setCustomError(null)
        }

        setOpen(false)
    }

    return (
        <Popover.Root
            open={open}
            onOpenChange={
                handleOpenChange
            }
        >
            <Popover.Trigger asChild>
                {settingsTrigger}
            </Popover.Trigger>

            <Popover.Portal>
                <Popover.Content
                    className="swap-settings-popover"
                    side="bottom"
                    align="end"
                    sideOffset={10}
                    collisionPadding={12}
                    avoidCollisions
                    onOpenAutoFocus={(event) => {
                        event.preventDefault()

                        if (
                            settings.slippageMode ===
                            'custom'
                        ) {
                            customInputRef.current?.focus()
                            return
                        }

                        autoButtonRef.current?.focus()
                    }}
                >
                    <section className="slippage-setting">
                        <div className="slippage-setting-row">
                            <div className="slippage-label-column">
                                <div className="settings-row-label">
                                    <span>
                                        Max slippage
                                    </span>

                                    <InfoTooltip label="The maximum price movement allowed before the transaction is cancelled." />
                                </div>

                                {warningLabel && (
                                    <div
                                        className={[
                                            'slippage-warning',
                                            `slippage-warning-${activeSeverity}`,
                                        ].join(' ')}
                                        role="status"
                                    >
                                        <WarningIcon />

                                        <span>
                                            {warningLabel}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div
                                className={[
                                    'slippage-combined-control',

                                    isAuto
                                        ? 'is-auto'
                                        : 'is-custom',

                                    activeSeverity ===
                                    'high'
                                        ? 'is-high'
                                        : '',

                                    activeSeverity ===
                                    'very-high'
                                        ? 'is-very-high'
                                        : '',

                                    customError
                                        ? 'is-invalid'
                                        : '',
                                ]
                                    .filter(Boolean)
                                    .join(' ')}
                            >
                                <button
                                    ref={autoButtonRef}
                                    type="button"
                                    className="slippage-auto-button"
                                    onClick={selectAuto}
                                    aria-pressed={isAuto}
                                    aria-label="Use automatic slippage of 2.5%"
                                >
                                    Auto
                                </button>

                                <label
                                    className="slippage-custom-control"
                                    onPointerDown={
                                        handleCustomPointerDown
                                    }
                                >
                                    <span className="sr-only">
                                        Custom slippage percentage
                                    </span>

                                    <input
                                        ref={customInputRef}
                                        value={customInput}
                                        onChange={
                                            updateCustom
                                        }
                                        onFocus={
                                            handleCustomFocus
                                        }
                                        onBlur={
                                            handleCustomBlur
                                        }
                                        onKeyDown={
                                            handleCustomKeyDown
                                        }
                                        inputMode="decimal"
                                        autoComplete="off"
                                        spellCheck="false"
                                        placeholder=""
                                        aria-label="Custom slippage percentage"
                                        aria-invalid={
                                            Boolean(
                                                customError,
                                            )
                                        }
                                    />

                                    <span
                                        className="slippage-percent-symbol"
                                        aria-hidden="true"
                                    >
                                        %
                                    </span>
                                </label>
                            </div>
                        </div>

                        {customError &&
                            customInput.trim() !== '' && (
                                <p
                                    className="settings-error"
                                    role="alert"
                                >
                                    {customError}
                                </p>
                            )}
                    </section>

                    <SettingsToggleRow
                        label="Hide unknown tokens"
                        tooltip="Unverified, spam-like, and potentially risky tokens will be hidden from your portfolio."
                        checked={
                            settings.hideUnknownTokens
                        }
                        onCheckedChange={(checked) => {
                            onSettingsChange({
                                ...settings,

                                hideUnknownTokens:
                                checked,
                            })
                        }}
                    />

                    <SettingsToggleRow
                        label="Hide small balances"
                        tooltip="Balances under 20 cents will be hidden from your portfolio."
                        checked={
                            settings.hideSmallBalances
                        }
                        onCheckedChange={(checked) => {
                            onSettingsChange({
                                ...settings,

                                hideSmallBalances:
                                checked,
                            })
                        }}
                    />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}
