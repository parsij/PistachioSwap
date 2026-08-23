import { useState } from 'react'
import { motion } from 'motion/react'
import { useWalletRuntimeStatus } from '#wallet-runtime'

/**
 * Renders the single primary swap CTA from a derived action model.
 * @param {{action: {type: string, label: string, enabled: boolean, loading?: boolean}, reducedMotion: boolean, triggerRef: object, onAction: () => void|Promise<void>}} props CTA contract.
 * @returns {import('react').ReactElement} Existing primary action button.
 * @sideEffects Calls `onAction`; wallet/network behavior belongs to the controller.
 */
export default function SwapPrimaryAction({ action, reducedMotion, triggerRef, onAction }) {
    const runtime = useWalletRuntimeStatus()
    const [connecting, setConnecting] = useState(false)
    const restoring = action.type === 'connect' && runtime.visible
    const busy = Boolean(action.loading || connecting || restoring)
    const label = action.type === 'connect' && busy ? 'Connecting…' : action.label

    async function handleClick() {
        if (!action.enabled || busy) return
        if (action.type !== 'connect') {
            onAction()
            return
        }
        setConnecting(true)
        try {
            await onAction()
        } finally {
            setConnecting(false)
        }
    }

    return (
        <motion.button
            ref={triggerRef}
            type="button"
            disabled={!action.enabled || busy}
            className={[
                'primary-action',
                action.enabled && !busy ? 'primary-action-ready' : '',
                action.type === 'insufficient-funds' ? 'primary-action-insufficient' : '',
            ].filter(Boolean).join(' ')}
            whileTap={action.enabled && !busy && !reducedMotion ? { scale: 0.985 } : undefined}
            onClick={handleClick}
            aria-busy={busy || undefined}
        >
            {label}
        </motion.button>
    )
}
