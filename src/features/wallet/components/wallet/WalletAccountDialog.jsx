import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
    Copy,
    LogOut,
    Send,
    X,
    QrCode,
} from 'lucide-react'
import { useDisconnect } from 'wagmi'

import ReceiveDialog from './ReceiveDialog.jsx'
import SendAssetDialog from './SendAssetDialog.jsx'
import WalletAssetList from './WalletAssetList.jsx'
import {
    WalletAvatar,
} from './WalletAccountButton.jsx'
import { shortenAddress } from '../../../../services/address.js'

/** Composes wallet assets, receive/send, refresh, explorer, and disconnect controls in a Radix dialog. */
export default function WalletAccountDialog({
    open,
    onOpenChange,
    address,
    chainId,
    nativeBalance,
    nativeToken,
    walletTokens,
    settings,
    selectedTokens,
    explorerUrl,
    onRefetch,
}) {
    const { mutate: disconnect } = useDisconnect()
    const [receiveOpen, setReceiveOpen] = useState(false)
    const [sendOpen, setSendOpen] = useState(false)
    const [copied, setCopied] = useState(false)
    const enrichedNativeToken = nativeToken ? {
        ...nativeToken,
        balance: nativeBalance.formatted ?? '0',
        rawBalance: nativeBalance.value?.toString() ?? '0',
        valueUSD: null,
    } : null
    const assets = walletTokens.map((token) =>
        enrichedNativeToken &&
        Number(token.chainId) === Number(enrichedNativeToken.chainId) &&
        token.address.toLowerCase() === enrichedNativeToken.address.toLowerCase()
            ? enrichedNativeToken
            : token,
    )
    const heldAssets = assets.filter((token) =>
        /^\d+$/.test(String(token.rawBalance ?? ''))
            ? BigInt(token.rawBalance) > 0n
            : Number(token.balance) > 0,
    )
    const heldNetworkCount = new Set(
        heldAssets.map((token) => Number(token.chainId)),
    ).size

    async function copyAddress() {
        await navigator.clipboard.writeText(address)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1400)
    }

    function handleDisconnect() {
        onOpenChange(false)
        disconnect()
    }

    return (
        <>
            <Dialog.Root open={open} onOpenChange={onOpenChange}>
                <Dialog.Portal>
                    <Dialog.Overlay className="wallet-dialog-overlay" />
                    <Dialog.Content className="wallet-dialog wallet-account-dialog">
                        <header className="wallet-dialog-header">
                            <div className="wallet-network-label">
                                <span className="wallet-all-networks-icon" aria-hidden="true">∞</span>
                                <Dialog.Title>All Networks</Dialog.Title>
                            </div>
                            <Dialog.Close className="wallet-icon-button" aria-label="Close account dialog">
                                <X aria-hidden="true" />
                            </Dialog.Close>
                        </header>

                        <section className="wallet-account-summary">
                            <WalletAvatar address={address} size="lg" />
                            <button type="button" className="wallet-address-button" onClick={copyAddress}>
                                <span>{shortenAddress(address, 6)}</span>
                                <Copy aria-hidden="true" />
                            </button>
                            <strong className="wallet-native-balance">
                                {heldAssets.length} {heldAssets.length === 1 ? 'asset' : 'assets'}
                            </strong>
                            <span className="wallet-native-value">
                                Across {heldNetworkCount} {heldNetworkCount === 1 ? 'network' : 'networks'}
                            </span>
                            {copied && <span className="wallet-copy-notice" role="status">Address copied</span>}
                        </section>

                        <div className="wallet-primary-actions">
                            <button type="button" onClick={() => setReceiveOpen(true)}>
                                <QrCode aria-hidden="true" />
                                Receive
                            </button>
                            <button type="button" onClick={() => setSendOpen(true)}>
                                <Send aria-hidden="true" />
                                Send
                            </button>
                            <button type="button" onClick={handleDisconnect}>
                                <LogOut aria-hidden="true" />
                                Disconnect
                            </button>
                        </div>

                        <section className="wallet-assets-section">
                            <h2>Assets</h2>
                            <WalletAssetList
                                tokens={assets}
                                settings={settings}
                                selectedTokens={selectedTokens}
                            />
                        </section>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            <ReceiveDialog
                open={receiveOpen}
                onOpenChange={setReceiveOpen}
                address={address}
            />
            <SendAssetDialog
                key={address}
                open={sendOpen}
                onOpenChange={setSendOpen}
                address={address}
                chainId={chainId}
                assets={assets.filter(
                    (token) => Number(token.chainId) === Number(chainId),
                )}
                settings={settings}
                nativeBalanceWei={nativeBalance.value ?? 0n}
                explorerUrl={explorerUrl}
                onConfirmed={onRefetch}
            />
        </>
    )
}
