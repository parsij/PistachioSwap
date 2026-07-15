import { useAppKit } from '@reown/appkit/react'
import { shortenAddress } from '../../services/address.js'

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

export default function WalletAccountButton({
    isConnected,
    address,
    onConnectedClick,
}) {
    const { open } = useAppKit()

    if (!isConnected) {
        return (
            <button
                type="button"
                className="wallet-connect-button"
                onClick={() => open({ view: 'Connect' })}
            >
                Connect
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
