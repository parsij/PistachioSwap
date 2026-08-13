import { LayoutGroup } from 'motion/react'
import SwapTokenPanel from './SwapTokenPanel.jsx'
import SwapBalanceNotice from './SwapBalanceNotice.jsx'
import SwapDirectionButton from './SwapDirectionButton.jsx'
import SwapPrimaryAction from './SwapPrimaryAction.jsx'
import SwapDetails from './SwapDetails.jsx'
import TransactionStatus from './TransactionStatus.jsx'

/**
 * Composes the two token panels, primary CTA, quote details, and status area.
 * Gas Assist's low-BNB disclosure is kept inline beside the execution status.
 * @param {{sellPanel: object, buyPanel: object, direction: object, primaryAction: object, details: object, status: object}} props Card view models.
 * @returns {import('react').ReactElement} Existing swap-card content.
 * @sideEffects Delegates all interactions to semantic callbacks supplied by the controller.
 */
export default function SwapCard({ sellPanel, buyPanel, direction, primaryAction, details, status }) {
    return (
        <>
            <LayoutGroup id="swap-layout">
                <div className="swap-panels">
                    <SwapTokenPanel {...sellPanel} />
                    <SwapDirectionButton {...direction} />
                    <SwapTokenPanel {...buyPanel} />
                </div>
            </LayoutGroup>
            <SwapBalanceNotice
                notice={sellPanel.balance?.notice ?? null}
                onRetry={sellPanel.balance?.onRetry ?? null}
            />
            <SwapPrimaryAction {...primaryAction} />
            <SwapDetails {...details} />
            <TransactionStatus {...status} />
        </>
    )
}
