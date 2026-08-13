import { Info } from 'lucide-react'

import AppInfoTooltip from '../../../shared/components/AppInfoTooltip.jsx'

/**
 * Renders the settings feature's explanatory info control.
 * Hover follows the pointer between the icon and explanation; click/tap pins
 * the explanation until the user clicks elsewhere or presses Escape.
 */
export default function InfoTooltip({ label }) {
    return (
        <AppInfoTooltip
            ariaLabel={label}
            icon={<Info aria-hidden="true" />}
            triggerClassName="settings-info-button swap-info-trigger"
        >
            {label}
        </AppInfoTooltip>
    )
}
