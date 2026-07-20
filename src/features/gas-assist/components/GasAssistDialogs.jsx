import GasAssistApprovalDialog from './GasAssistApprovalDialog.jsx'
import GasAssistPrepaymentDialog from './GasAssistPrepaymentDialog.jsx'

/**
 * Composes Gas Assist approval and prepaid sponsorship dialogs from feature-owned state.
 * @param {{approval: object, prepayment: object}} props Dialog view models.
 * @returns {import('react').ReactElement} Gas Assist dialog fragment.
 * @sideEffects Child callbacks may request signatures/transactions; this component performs none directly.
 */
export default function GasAssistDialogs({ approval, prepayment }) {
    return (
        <>
            <GasAssistApprovalDialog {...approval} />
            <GasAssistPrepaymentDialog key={prepayment.key} {...prepayment.props} />
        </>
    )
}
