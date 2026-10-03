import * as Tooltip from '@radix-ui/react-tooltip'
import { createCssVariables } from '../../../swapConfig.js'

const theme = createCssVariables()

export default function MarketActionTooltip({ label, children }) {
    return <Tooltip.Provider delayDuration={250}><Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal><Tooltip.Content className="market-action-tooltip" style={theme} sideOffset={8} collisionPadding={12}>
            {label}<Tooltip.Arrow />
        </Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root></Tooltip.Provider>
}
