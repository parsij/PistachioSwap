import { motion } from 'motion/react'

/**
 * Renders the single primary swap CTA from a derived action model.
 * @param {{action: {type: string, label: string, enabled: boolean}, reducedMotion: boolean, triggerRef: object, onAction: () => void}} props CTA contract.
 * @returns {import('react').ReactElement} Existing primary action button.
 * @sideEffects Calls `onAction`; wallet/network behavior belongs to the controller.
 */
export default function SwapPrimaryAction({ action, reducedMotion, triggerRef, onAction }) {
    return (
        <motion.button
            ref={triggerRef}
            type="button"
            disabled={!action.enabled}
            className={[
                'primary-action',
                action.enabled ? 'primary-action-ready' : '',
                action.type === 'insufficient-funds' ? 'primary-action-insufficient' : '',
            ].filter(Boolean).join(' ')}
            whileTap={action.enabled && !reducedMotion ? { scale: 0.985 } : undefined}
            onClick={onAction}
        >
            {action.label}
        </motion.button>
    )
}
