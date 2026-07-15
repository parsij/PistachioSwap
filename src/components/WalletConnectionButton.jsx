import {
    AppKitNetworkButton,
} from '@reown/appkit/react'
import { useState } from 'react'

import WalletAccountButton from './wallet/WalletAccountButton.jsx'
import WalletAccountDialog from './wallet/WalletAccountDialog.jsx'
import './wallet/wallet.css'

export function WalletNetworkButton() {
    return (
        <div
            className="appkit-network-control"
            aria-label="BNB Chain network"
        >
            <AppKitNetworkButton />
        </div>
    )
}

export default function WalletConnectionButton({
    walletState,
    nativeBalance,
    nativeToken,
    walletTokens,
    settings,
    selectedTokens,
    explorerUrl,
    onRefetch,
}) {
    const [accountOpen, setAccountOpen] = useState(false)

    return (
        <div className="appkit-account-control">
            <WalletAccountButton
                isConnected={walletState.isConnected}
                address={walletState.address}
                onConnectedClick={() => setAccountOpen(true)}
            />
            {walletState.isConnected && (
                <WalletAccountDialog
                    open={accountOpen}
                    onOpenChange={setAccountOpen}
                    address={walletState.address}
                    chainId={walletState.chainId}
                    nativeBalance={nativeBalance}
                    nativeToken={nativeToken}
                    walletTokens={walletTokens}
                    settings={settings}
                    selectedTokens={selectedTokens}
                    explorerUrl={explorerUrl}
                    onRefetch={onRefetch}
                />
            )}
        </div>
    )
}
