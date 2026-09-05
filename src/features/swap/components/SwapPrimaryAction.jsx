import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useWalletRuntimeStatus } from '#wallet-runtime'
import './SwapPrimaryAction.css'

/**
 * Renders the single primary swap CTA from a derived action model.
 * @param {{action: {type: string, label: string, enabled: boolean, loading?: boolean}, reducedMotion: boolean, triggerRef: object, onAction: () => void|Promise<void>}} props CTA contract.
 * @returns {import('react').ReactElement} Existing primary action button.
 * @sideEffects Calls `onAction`; wallet/network behavior belongs to the controller.
 */
export default function SwapPrimaryAction({ action, reducedMotion, triggerRef, onAction }) {
    const runtime = useWalletRuntimeStatus()
    const [connecting, setConnecting] = useState(false)
    const [networkSwitchState, setNetworkSwitchState] = useState('idle')
    const attemptedNetworkRef = useRef(null)
    const onActionRef = useRef(onAction)
    const restoring = action.type === 'connect' && runtime.visible
    const busy = Boolean(action.loading || connecting || restoring)
    const automaticNetworkSwitch = action.type === 'switch-network'
    const networkSwitching = automaticNetworkSwitch && networkSwitchState === 'switching'
    const networkSwitchRetry = automaticNetworkSwitch && networkSwitchState === 'retry'
    const label = action.type === 'connect' && busy ? 'Connecting…' : action.label

    useEffect(() => {
        onActionRef.current = onAction
    }, [onAction])

    useEffect(() => {
        if (!automaticNetworkSwitch) {
            attemptedNetworkRef.current = null
            setNetworkSwitchState('idle')
            return undefined
        }

        const targetKey = action.label
        if (attemptedNetworkRef.current === targetKey) return undefined
        attemptedNetworkRef.current = targetKey
        setNetworkSwitchState('switching')

        let cancelled = false
        let retryTimer = null
        Promise.resolve(onActionRef.current()).finally(() => {
            if (cancelled) return
            retryTimer = window.setTimeout(() => {
                if (!cancelled) setNetworkSwitchState('retry')
            }, 650)
        })

        return () => {
            cancelled = true
            if (retryTimer !== null) window.clearTimeout(retryTimer)
        }
    }, [action.label, automaticNetworkSwitch])

    async function retryNetworkSwitch() {
        if (!networkSwitchRetry) return
        setNetworkSwitchState('switching')
        await onActionRef.current()
        window.setTimeout(() => {
            setNetworkSwitchState((current) => current === 'switching' ? 'retry' : current)
        }, 650)
    }

    async function handleClick() {
        if (!action.enabled || busy) return
        if (automaticNetworkSwitch) {
            if (networkSwitching) return
            await retryNetworkSwitch()
            return
        }
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

    const autoSwitchAriaLabel = networkSwitchRetry
        ? 'Retry network switch'
        : automaticNetworkSwitch
            ? 'Switching network automatically'
            : undefined

    return (
        <motion.button
            ref={triggerRef}
            type="button"
            disabled={!action.enabled || busy}
            className={[
                'primary-action',
                action.enabled && !busy ? 'primary-action-ready' : '',
                action.type === 'insufficient-funds' ? 'primary-action-insufficient' : '',
                automaticNetworkSwitch ? 'primary-action-auto-switch' : '',
            ].filter(Boolean).join(' ')}
            data-auto-switch-state={automaticNetworkSwitch ? networkSwitchState : undefined}
            whileTap={action.enabled && !busy && !networkSwitching && !reducedMotion ? { scale: 0.985 } : undefined}
            onClick={handleClick}
            aria-label={autoSwitchAriaLabel}
            aria-disabled={networkSwitching || undefined}
            aria-busy={busy || networkSwitching || undefined}
        >
            {label}
        </motion.button>
    )
}
