import { LayoutGroup } from 'motion/react'
import GasAssistBanner from '../../gas-assist/components/GasAssistBanner.jsx'
import SwapTokenPanel from './SwapTokenPanel.jsx'
import SwapDirectionButton from './SwapDirectionButton.jsx'
import SwapPrimaryAction from './SwapPrimaryAction.jsx'
import SwapDetails from './SwapDetails.jsx'
import TransactionStatus from './TransactionStatus.jsx'

/**
 * Composes the two token panels, primary CTA, quote details, route cards, Gas Assist banner, and status area.
 * @param {{sellPanel: object, buyPanel: object, direction: object, primaryAction: object, details: object, gasAssistBanner: object|null, status: object}} props Card view models.
 * @returns {import('react').ReactElement} Existing swap-card content.
 * @sideEffects Delegates all interactions to semantic callbacks supplied by the controller.
 */
export default function SwapCard({ sellPanel, buyPanel, direction, primaryAction, details, gasAssistBanner, status }) {
    return (
        <>
            <LayoutGroup id="swap-layout">
                <div className="swap-panels">
                    <SwapTokenPanel {...sellPanel} />
                    <SwapDirectionButton {...direction} />
                    <SwapTokenPanel {...buyPanel} />
                </div>
            </LayoutGroup>
            <SwapPrimaryAction {...primaryAction} />
            <SwapDetails {...details} />
            {gasAssistBanner && <GasAssistBanner {...gasAssistBanner} />}
            <TransactionStatus {...status} />
        </>
    )
}
