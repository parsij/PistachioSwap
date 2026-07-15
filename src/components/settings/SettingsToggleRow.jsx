import { useId } from 'react'

import * as Switch from '@radix-ui/react-switch'

import InfoTooltip from './InfoTooltip.jsx'

function CheckIcon() {
    return (
        <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
        >
            <path
                d="m5.25 10.25 3.05 3.05 6.45-6.45"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.35"
            />
        </svg>
    )
}

export default function SettingsToggleRow({
                                              label,
                                              tooltip,
                                              checked,
                                              onCheckedChange,
                                              disabled = false,
                                          }) {
    const generatedId = useId()

    const switchId =
        `settings-toggle-${generatedId}`

    return (
        <div className="settings-toggle-row">
            <div className="settings-toggle-copy">
                <div className="settings-row-label">
                    <label htmlFor={switchId}>
                        {label}
                    </label>

                    <InfoTooltip
                        label={tooltip}
                    />
                </div>
            </div>

            <Switch.Root
                id={switchId}
                className="uniswap-toggle"
                checked={checked}
                disabled={disabled}
                onCheckedChange={
                    onCheckedChange
                }
                aria-label={label}
            >
                <Switch.Thumb className="uniswap-toggle-thumb">
                    <span className="uniswap-toggle-check">
                        <CheckIcon />
                    </span>
                </Switch.Thumb>
            </Switch.Root>
        </div>
    )
}