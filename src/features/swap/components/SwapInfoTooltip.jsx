import * as Tooltip from '@radix-ui/react-tooltip'
import { InfoIcon } from '../../../shared/components/AppIcons.jsx'

/**
 * Renders the existing portaled explanatory tooltip used by swap detail labels.
 * @param {{ariaLabel: string, children: import('react').ReactNode}} props Component props.
 * @returns {import('react').ReactElement} Accessible tooltip trigger and portal.
 * @sideEffects Mounts Radix tooltip content under `document.body` and stops trigger click propagation.
 */
export default function SwapInfoTooltip({ ariaLabel, children }) {
    function stopInfoTriggerPropagation(event) {
        event.stopPropagation()
    }

    return (
        <Tooltip.Provider delayDuration={200}>
            <Tooltip.Root>
                <Tooltip.Trigger asChild>
                    <button
                        type="button"
                        className="swap-info-trigger"
                        aria-label={ariaLabel}
                        onPointerDown={stopInfoTriggerPropagation}
                        onClick={stopInfoTriggerPropagation}
                    >
                        <InfoIcon />
                    </button>
                </Tooltip.Trigger>
                <Tooltip.Portal container={document.body}>
                    <Tooltip.Content className="swap-info-tooltip" sideOffset={7} collisionPadding={12}>
                        {children}
                        <Tooltip.Arrow className="swap-info-tooltip-arrow" />
                    </Tooltip.Content>
                </Tooltip.Portal>
            </Tooltip.Root>
        </Tooltip.Provider>
    )
}
