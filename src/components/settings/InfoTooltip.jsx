import * as Tooltip from '@radix-ui/react-tooltip'
import { Info } from 'lucide-react'

export default function InfoTooltip({ label }) {
    return (
        <Tooltip.Provider delayDuration={250}>
            <Tooltip.Root>
                <Tooltip.Trigger asChild>
                    <button
                        type="button"
                        className="settings-info-button"
                        aria-label={label}
                    >
                        <Info aria-hidden="true" />
                    </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                    <Tooltip.Content
                        className="settings-tooltip"
                        sideOffset={7}
                    >
                        {label}
                        <Tooltip.Arrow className="settings-tooltip-arrow" />
                    </Tooltip.Content>
                </Tooltip.Portal>
            </Tooltip.Root>
        </Tooltip.Provider>
    )
}
