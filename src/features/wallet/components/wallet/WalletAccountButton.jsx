import { useState } from 'react'
import { useAppKit, useWalletRuntimeStatus } from '#wallet-runtime'
import { shortenAddress } from '../../../../services/address.js'

export function WalletAvatar({ address, size = 'md' }) {
    const color = address ? `#${address.slice(2, 8)}` : '#666666'
    return (
        <span
            className={`wallet-avatar wallet-avatar-${size}`}
            style={{ backgroundColor: color }}
            aria-hidden="true"
        >
            <span />
            <span />
            <span />
            <span />
        </span>
    )
}

/** Renders connect or normalized account identity and emits the appropriate open callback. */
export default function WalletAccountButton({
    isConnected,
    address,
    onConnectedClick,
}) {
    const { open } = useAppKit()
    const runtime = useWalletRuntimeStatus()
    const [opening, setOpening] = useState(false)
    const busy = opening || runtime.visible

    async function handleConnect() {
        if (busy) return
        setOpening(true)
        try {
            await open({ view: 'Connect' })
        } finally {
            setOpening(false)
        }
    }

    if (!isConnected) {
        return (
            <button
                type="button"
                className="wallet-connect-button"
                onClick={handleConnect}
                aria-busy={busy || undefined}
                aria-live="polite"
                disabled={busy}
            >
                {busy ? 'Connecting' : 'Connect'}
            </button>
        )
    }

    return (
        <button
            type="button"
            className="wallet-account-button"
            onClick={onConnectedClick}
            aria-label={`Open account ${shortenAddress(address)}`}
        >
            <WalletAvatar address={address} size="sm" />
            <span>{shortenAddress(address)}</span>
        </button>
    )
}
