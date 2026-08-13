import { InfoIcon } from '../../../shared/components/AppIcons.jsx'
import AppInfoTooltip from '../../../shared/components/AppInfoTooltip.jsx'

/**
 * Renders the explanatory info control used by swap detail labels.
 * Hover keeps the explanation open while the pointer is on the icon or card;
 * click/tap pins it until an outside interaction or Escape.
 */
export default function SwapInfoTooltip({ ariaLabel, children }) {
    return (
        <AppInfoTooltip
            ariaLabel={ariaLabel}
            icon={<InfoIcon />}
            stopPropagation
        >
            {children}
        </AppInfoTooltip>
    )
}
