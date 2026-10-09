import { useConnection } from '#wallet-runtime'
import { useEffect, useRef, useState } from 'react'

import WalletAccountButton from './wallet/WalletAccountButton.jsx'
import WalletAccountDialog from './wallet/WalletAccountDialog.jsx'
import './wallet/wallet.css'
import './wallet/sendAssetDialog.css'
import './wallet/walletAccount.mobile.css'
import './wallet/walletTypography.css'
import './wallet/walletSheetDrag.js'

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
    const connection = useConnection()
    const [accountOpen, setAccountOpen] = useState(false)
    const [requestedAction, setRequestedAction] = useState(null)
    const requestSequence = useRef(0)
    const accountControl = useRef(null)

    useEffect(() => {
        function handleWalletAction(event) {
            if (!walletState.isConnected) return
            const action = String(event.detail?.action ?? '')
            if (!['overview', 'portfolio', 'activity', 'send', 'receive'].includes(action)) {
                return
            }
            requestSequence.current += 1
            setRequestedAction({
                action,
                requestId: requestSequence.current,
            })
            setAccountOpen(true)
        }

        window.addEventListener('pistachio:open-wallet-action', handleWalletAction)
        return () => window.removeEventListener(
            'pistachio:open-wallet-action',
            handleWalletAction,
        )
    }, [walletState.isConnected])

    function handleAccountOpenChange(open) {
        setAccountOpen(open)
        if (!open) setRequestedAction(null)
    }

    return (
        <div className="appkit-account-control" ref={accountControl}>
            <WalletAccountButton
                isConnected={walletState.isConnected}
                address={walletState.address}
                onConnectedClick={() => setAccountOpen(true)}
            />
            {walletState.isConnected && (
                <WalletAccountDialog
                    isLocalWallet={connection?.connector?.id === 'pistachio-local'}
                    open={accountOpen}
                    onOpenChange={handleAccountOpenChange}
                    onReturnFocus={() => accountControl.current?.querySelector('.wallet-account-button')?.focus()}
                    requestedAction={requestedAction}
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
