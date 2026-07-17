import { useState } from 'react'

import WalletAccountButton from './wallet/WalletAccountButton.jsx'
import WalletAccountDialog from './wallet/WalletAccountDialog.jsx'
import './wallet/wallet.css'

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
