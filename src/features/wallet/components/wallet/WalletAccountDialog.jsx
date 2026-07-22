import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
    Check,
    Copy,
    LogOut,
    QrCode,
    RefreshCw,
    Send,
    X,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useDisconnect } from 'wagmi'

import ReceiveDialog from './ReceiveDialog.jsx'
import SendAssetDialog from './SendAssetDialog.jsx'
import WalletAssetList from './WalletAssetList.jsx'
import { WalletAvatar } from './WalletAccountButton.jsx'
import { shortenAddress } from '../../../../services/address.js'
import { resolveWalletUsdValue } from '../../../tokens/services/walletTokens.js'
import './walletAccount.css'

function portfolioValue(tokens) {
    const values = tokens
        .map(resolveWalletUsdValue)
        .map(Number)
        .filter((value) => Number.isFinite(value) && value >= 0)
    if (values.length === 0) return null
    return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(values.reduce((total, value) => total + value, 0))
}

/** Compact account sheet inspired by mature wallet UIs while retaining local wallet actions. */
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
    const [refreshing, setRefreshing] = useState(false)
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
            : token)
    const heldAssets = assets.filter((token) =>
        /^\d+$/.test(String(token.rawBalance ?? ''))
            ? BigInt(token.rawBalance) > 0n
            : Number(token.balance) > 0)
    const heldNetworkCount = new Set(
        heldAssets.map((token) => Number(token.chainId)),
    ).size
    const totalValue = useMemo(
        () => portfolioValue(heldAssets),
        [heldAssets],
    )

    async function copyAddress() {
        try {
            await navigator.clipboard?.writeText(address)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1400)
        } catch {
            setCopied(false)
        }
    }

    async function refreshAssets() {
        if (refreshing) return
        setRefreshing(true)
        try {
            await onRefetch?.()
        } finally {
            setRefreshing(false)
        }
    }

    function handleDisconnect() {
        onOpenChange(false)
        disconnect()
    }

    return (
        <>
            <Dialog.Root open={open} onOpenChange={onOpenChange}>
                <Dialog.Portal>
                    <Dialog.Overlay className="wallet-dialog-overlay wallet-account-overlay-v2" />
                    <Dialog.Content className="wallet-dialog wallet-account-dialog wallet-account-dialog-v2">
                        <motion.div
                            className="wallet-account-shell-v2"
                            initial={{ opacity: 0, scale: 0.985, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            transition={{ duration: 0.18, ease: 'easeOut' }}
                        >
                            <header className="wallet-account-header-v2">
                                <div>
                                    <Dialog.Title>Wallet</Dialog.Title>
                                    <span className="wallet-network-pill-v2">
                                        <span aria-hidden="true">∞</span>
                                        All networks
                                    </span>
                                </div>
                                <Dialog.Close className="wallet-icon-button wallet-close-v2" aria-label="Close account dialog">
                                    <X aria-hidden="true" />
                                </Dialog.Close>
                            </header>

                            <section className="wallet-profile-card-v2">
                                <WalletAvatar address={address} size="md" />
                                <div className="wallet-profile-copy-v2">
                                    <strong>{shortenAddress(address, 6)}</strong>
                                    <button type="button" onClick={copyAddress} aria-label="Copy wallet address">
                                        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                                        {copied ? 'Copied' : 'Copy address'}
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    className="wallet-disconnect-v2"
                                    onClick={handleDisconnect}
                                    aria-label="Disconnect wallet"
                                >
                                    <LogOut aria-hidden="true" />
                                </button>
                            </section>

                            <section className="wallet-portfolio-summary-v2">
                                <div>
                                    <span>Portfolio</span>
                                    <strong>{totalValue ?? `${heldAssets.length} assets`}</strong>
                                </div>
                                <span>
                                    {heldAssets.length} {heldAssets.length === 1 ? 'asset' : 'assets'} · {heldNetworkCount} {heldNetworkCount === 1 ? 'network' : 'networks'}
                                </span>
                            </section>

                            <div className="wallet-actions-v2">
                                <button type="button" onClick={() => setReceiveOpen(true)}>
                                    <span><QrCode aria-hidden="true" /></span>
                                    Receive
                                </button>
                                <button type="button" onClick={() => setSendOpen(true)}>
                                    <span><Send aria-hidden="true" /></span>
                                    Send
                                </button>
                            </div>

                            <section className="wallet-assets-section wallet-assets-section-v2">
                                <div className="wallet-assets-heading-v2">
                                    <h2>Assets</h2>
                                    <button
                                        type="button"
                                        onClick={refreshAssets}
                                        disabled={refreshing}
                                        aria-label="Refresh wallet assets"
                                    >
                                        <RefreshCw className={refreshing ? 'spinning' : ''} aria-hidden="true" />
                                    </button>
                                </div>
                                <WalletAssetList
                                    tokens={heldAssets}
                                    settings={settings}
                                    selectedTokens={selectedTokens}
                                />
                            </section>
                        </motion.div>
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
                assets={heldAssets.filter(
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
