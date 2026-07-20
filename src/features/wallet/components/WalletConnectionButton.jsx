import { useState } from 'react'

import WalletAccountButton from './wallet/WalletAccountButton.jsx'
import WalletAccountDialog from './wallet/WalletAccountDialog.jsx'
import './wallet/wallet.css'

/**
 * Composes the connected-account button and wallet account dialog.
 * @param {object} props Wallet/balance/token/settings/explorer data and async refresh callback.
 * @returns {import('react').ReactElement} Existing header wallet control.
 * @sideEffects Opens account UI and delegates refresh/send/receive/disconnect actions to children.
 */
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
