import { Info } from 'lucide-react'

import AppInfoTooltip from '../../../shared/components/AppInfoTooltip.jsx'

/**
 * Renders the settings feature's explanatory info control.
 * Hover follows the pointer between the icon and explanation; click/tap pins
 * the explanation until the user clicks elsewhere or presses Escape.
 */
export default function InfoTooltip({ label, triggerLabel }) {
    return (
        <AppInfoTooltip
            ariaLabel={label}
            icon={<>{triggerLabel && <span className="settings-info-label">{triggerLabel}</span>}<Info aria-hidden="true" /></>}
            triggerClassName={`settings-info-button swap-info-trigger${triggerLabel ? " settings-info-with-label" : ""}`}
        >
            {label}
        </AppInfoTooltip>
    )
}
