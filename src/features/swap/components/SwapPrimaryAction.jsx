import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useWalletRuntimeStatus } from '#wallet-runtime'

/**
 * Renders the single primary swap CTA from a derived action model.
 * @param {{action: {type: string, label: string, enabled: boolean, loading?: boolean}, reducedMotion: boolean, triggerRef: object, onAction: () => void|Promise<void>}} props CTA contract.
 * @returns {import('react').ReactElement|null} Existing primary action button, or no CTA while an automatic network switch is requested.
 * @sideEffects Calls `onAction`; wallet/network behavior belongs to the controller.
 */
export default function SwapPrimaryAction({ action, reducedMotion, triggerRef, onAction }) {
    const runtime = useWalletRuntimeStatus()
    const [connecting, setConnecting] = useState(false)
    const attemptedNetworkRef = useRef(null)
    const onActionRef = useRef(onAction)
    const restoring = action.type === 'connect' && runtime.visible
    const busy = Boolean(action.loading || connecting || restoring)
    const automaticNetworkSwitch = action.type === 'switch-network'
    const label = action.type === 'connect' && busy ? 'Connecting…' : action.label

    useEffect(() => {
        onActionRef.current = onAction
    }, [onAction])

    useEffect(() => {
        if (!automaticNetworkSwitch) {
            attemptedNetworkRef.current = null
            return
        }

        const targetKey = action.label
        if (attemptedNetworkRef.current === targetKey) return
        attemptedNetworkRef.current = targetKey

        void Promise.resolve(onActionRef.current()).catch(() => {
            // The controller owns user-visible wallet/network errors. Do not
            // replace the swap CTA with a second network-switch UI state.
        })
    }, [action.label, automaticNetworkSwitch])

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

    if (automaticNetworkSwitch) return null

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
