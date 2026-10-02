import GasAssistPrepaymentDialog from './GasAssistPrepaymentDialog.jsx'

/**
 * Composes the active self-hosted Gas Assist sponsorship dialog.
 * @param {{prepayment: object}} props Dialog view model.
 * @returns {import('react').ReactElement} Gas Assist dialog fragment.
 * @sideEffects Child callbacks may request signatures/transactions; this component performs none directly.
 */
export default function GasAssistDialogs({ prepayment }) {
    return (
        <GasAssistPrepaymentDialog key={prepayment.key} {...prepayment.props} />
    )
}
