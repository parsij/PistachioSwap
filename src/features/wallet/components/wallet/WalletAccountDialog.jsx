import {
    useEffect,
    useMemo,
    useState,
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
    ArrowDownLeft,
    ArrowLeft,
    ArrowLeftRight,
    ArrowRight,
    ArrowUpRight,
    Check,
    CheckCircle2,
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
import TokenIcon from '../../../tokens/components/TokenIcon.jsx'
import { shortenAddress } from '../../../../services/address.js'
import { resolveWalletUsdValue } from '../../../tokens/services/walletTokens.js'
import {
    filterPortfolioTokens,
    isTrustedWalletToken,
} from '../../../tokens/services/portfolio.js'
import { getTokenDisplaySymbol } from '../../../tokens/services/tokenDisplay.js'
import { useWalletActivity } from '../../hooks/useWalletActivity.js'
import {
    getCuratedEvmChain,
    getCuratedEvmChainLogoUri,
} from '../../../../web3/curatedEvmChains.js'
import './walletAccount.css'

function portfolioValue(tokens) {
    const values = tokens
        .map(resolveWalletUsdValue)
        .map(Number)
        .filter((value) => Number.isFinite(value) && value >= 0)

    const total = values.reduce((sum, value) => sum + value, 0)
    return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(total)
}

function hasPositiveBalance(token) {
    const raw = String(token?.rawBalance ?? '')
    if (/^\d+$/.test(raw)) return BigInt(raw) > 0n
    return Number(token?.balance ?? 0) > 0
}

function tokenIdentity(token) {
    if (!token) return null
    return `${Number(token.chainId)}:${String(token.address ?? '').toLowerCase()}`
}

function findActivityToken(activity, assets) {
    const candidate = activity.type === 'swapped'
        ? activity.sellToken ?? activity.buyToken
        : activity.token
    if (!candidate) return null

    const address = String(candidate.address ?? '').toLowerCase()
    const match = assets.find((token) =>
        Number(token.chainId) === Number(activity.chainId) &&
        (
            (address && String(token.address ?? '').toLowerCase() === address) ||
            (!address && candidate.isNative && token.isNative)
        ),
    )

    return match ?? {
        ...candidate,
        chainId: activity.chainId,
        address: candidate.address ??
            '0x0000000000000000000000000000000000000000',
        symbol: candidate.symbol ?? 'Token',
        name: candidate.name ?? candidate.symbol ?? 'Token',
        logoURI: candidate.logoURI ?? null,
    }
}

function activityTokenTrusted(candidate, assets, chainId) {
    if (!candidate) return false
    if (candidate.isNative === true) return true
    const address = String(candidate.address ?? '').toLowerCase()
    const match = assets.find((token) =>
        Number(token.chainId) === Number(chainId) &&
        String(token.address ?? '').toLowerCase() === address)
    return match ? isTrustedWalletToken(match) : isTrustedWalletToken(candidate)
}

function filterTrustedActivity(items, assets) {
    return items.filter((activity) => {
        if (activity.type === 'contract') return false
        if (activity.type === 'swapped') {
            return activityTokenTrusted(activity.sellToken, assets, activity.chainId) &&
                activityTokenTrusted(activity.buyToken, assets, activity.chainId)
        }
        return activityTokenTrusted(activity.token, assets, activity.chainId)
    })
}

function compactAmount(value) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return null
    if (numeric === 0) return '0'
    if (Math.abs(numeric) < 0.001) return '<0.001'
    return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 6,
    }).format(numeric)
}

function activityTitle(type) {
    return {
        swapped: 'Swapped',
        approved: 'Approved',
        sent: 'Sent',
        received: 'Received',
        contract: 'Contract interaction',
    }[type] ?? 'Transaction'
}

function activitySummary(activity) {
    if (activity.type === 'swapped') {
        const sellAmount = compactAmount(activity.sellAmount)
        const buyAmount = compactAmount(activity.buyAmount)
        const sellSymbol = activity.sellToken
            ? getTokenDisplaySymbol(activity.sellToken)
            : null
        const buySymbol = activity.buyToken
            ? getTokenDisplaySymbol(activity.buyToken)
            : null

        if (sellAmount && sellSymbol && buyAmount && buySymbol) {
            return `${sellAmount} ${sellSymbol} → ${buyAmount} ${buySymbol}`
        }
        return 'Swap confirmed'
    }

    if (activity.type === 'approved') {
        const amount = compactAmount(activity.amount)
        const symbol = activity.token
            ? getTokenDisplaySymbol(activity.token)
            : null
        return amount && symbol
            ? `${amount} ${symbol}`
            : symbol
                ? `${symbol} spending approved`
                : 'Token spending approved'
    }

    if (activity.type === 'sent') {
        const amount = compactAmount(activity.amount)
        const symbol = activity.token
            ? getTokenDisplaySymbol(activity.token)
            : null
        const destination = activity.recipient
            ? ` to ${shortenAddress(activity.recipient, 5)}`
            : ''
        return amount && symbol
            ? `${amount} ${symbol}${destination}`
            : `Transaction sent${destination}`
    }

    if (activity.type === 'received') {
        const amount = compactAmount(activity.amount)
        const symbol = activity.token?.symbol
        return amount && symbol
            ? `${amount} ${symbol}`
            : 'Funds received'
    }

    return 'Transaction confirmed'
}

function activityTime(timestamp) {
    const parsed = Date.parse(timestamp)
    if (!Number.isFinite(parsed)) return ''

    const date = new Date(parsed)
    const now = new Date()
    if (date.toDateString() === now.toDateString()) {
        return new Intl.DateTimeFormat(undefined, {
            hour: 'numeric',
            minute: '2-digit',
        }).format(date)
    }

    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
    }).format(date)
}

function ActivityGlyph({ type }) {
    const Icon = {
        swapped: ArrowLeftRight,
        approved: CheckCircle2,
        sent: ArrowUpRight,
        received: ArrowDownLeft,
        contract: ArrowRight,
    }[type] ?? ArrowRight

    return <Icon aria-hidden="true" />
}

function ActivityRow({
    activity,
    assets,
    activeChainId,
    activeExplorerUrl,
}) {
    const token = findActivityToken(activity, assets)
    const chain = getCuratedEvmChain(Number(activity.chainId))
    const explorerBase =
        chain?.blockExplorers?.default?.url ??
        (Number(activity.chainId) === Number(activeChainId)
            ? activeExplorerUrl
            : null)
    const transactionUrl =
        explorerBase && activity.hash
            ? `${explorerBase.replace(/\/+$/, '')}/tx/${activity.hash}`
            : null

    const content = (
        <>
            <span className="uni-activity-token">
                {token
                    ? <TokenIcon token={token} size="list" />
                    : <span className="uni-activity-fallback"><ActivityGlyph type={activity.type} /></span>}
                <img
                    className="uni-activity-chain"
                    src={getCuratedEvmChainLogoUri(Number(activity.chainId))}
                    alt=""
                    onError={(event) => event.currentTarget.remove()}
                />
            </span>
            <span className="uni-activity-copy">
                <strong>{activityTitle(activity.type)}</strong>
                <span>{activitySummary(activity)}</span>
            </span>
            <time dateTime={activity.timestamp}>
                {activityTime(activity.timestamp)}
            </time>
        </>
    )

    return transactionUrl ? (
        <button
            type="button"
            className="uni-activity-row"
            onClick={() => window.open(transactionUrl, '_blank', 'noopener,noreferrer')}
        >
            {content}
        </button>
    ) : (
        <div className="uni-activity-row">
            {content}
        </div>
    )
}

/**
 * Uniswap-style right-side account panel using existing PistachioSwap wallet,
 * portfolio, send, receive, token-filter, and balance-refresh data.
 */
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
    const [view, setView] = useState('overview')
    const activityChainIds = useMemo(() => [...new Set([
        Number(chainId),
        ...walletTokens.map((token) => Number(token?.chainId)),
    ].filter((value) => Number.isSafeInteger(value) && value > 0))], [
        chainId,
        walletTokens,
    ])
    const {
        items: activity,
        loading: activityLoading,
        error: activityError,
    } = useWalletActivity({
        walletAddress: address,
        chainIds: activityChainIds,
        limit: 50,
    })

    const enrichedNativeToken = nativeToken ? {
        ...nativeToken,
        balance: nativeBalance.formatted ?? '0',
        rawBalance: nativeBalance.value?.toString() ?? '0',
        valueUSD: nativeToken.valueUSD ?? null,
    } : null

    const assets = useMemo(() => {
        const merged = walletTokens.map((token) =>
            enrichedNativeToken &&
            Number(token.chainId) === Number(enrichedNativeToken.chainId) &&
            String(token.address).toLowerCase() ===
                String(enrichedNativeToken.address).toLowerCase()
                ? enrichedNativeToken
                : token)

        if (
            enrichedNativeToken &&
            !merged.some((token) =>
                tokenIdentity(token) === tokenIdentity(enrichedNativeToken))
        ) {
            merged.unshift(enrichedNativeToken)
        }

        return merged
    }, [enrichedNativeToken, walletTokens])

    const heldAssets = useMemo(
        () => assets.filter(hasPositiveBalance),
        [assets],
    )
    const visiblePortfolioAssets = useMemo(
        () => filterPortfolioTokens(heldAssets, {
            ...settings,
            selectedTokens,
        }),
        [heldAssets, selectedTokens, settings],
    )
    const totalValue = useMemo(
        () => portfolioValue(visiblePortfolioAssets),
        [visiblePortfolioAssets],
    )
    const visibleActivity = useMemo(
        () => filterTrustedActivity(activity, assets),
        [activity, assets],
    )
    const recentActivity = visibleActivity.slice(0, 3)

    useEffect(() => {
        if (!open) {
            setView('overview')
            setCopied(false)
        }
    }, [open])

    useEffect(() => {
        setView('overview')
    }, [address])

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

    function renderOverview() {
        return (
            <>
                <section className="uni-wallet-identity">
                    <div className="uni-wallet-topline">
                        <WalletAvatar address={address} size="md" />
                        <div className="uni-wallet-controls">
                            <img
                                src="/icons/PistachioLogo.svg"
                                alt=""
                                className="uni-wallet-brand"
                            />
                            <button
                                type="button"
                                aria-label="Refresh wallet"
                                onClick={refreshAssets}
                                disabled={refreshing}
                            >
                                <RefreshCw
                                    className={refreshing ? 'spinning' : ''}
                                    aria-hidden="true"
                                />
                            </button>
                            <button
                                type="button"
                                aria-label="Disconnect wallet"
                                onClick={handleDisconnect}
                            >
                                <LogOut aria-hidden="true" />
                            </button>
                            <Dialog.Close
                                className="uni-wallet-mobile-close"
                                aria-label="Close wallet"
                            >
                                <X aria-hidden="true" />
                            </Dialog.Close>
                        </div>
                    </div>

                    <button
                        type="button"
                        className="uni-wallet-address"
                        onClick={copyAddress}
                    >
                        <strong>{shortenAddress(address, 6)}</strong>
                        {copied
                            ? <Check aria-hidden="true" />
                            : <Copy aria-hidden="true" />}
                    </button>

                    <strong className="uni-wallet-value">{totalValue}</strong>
                </section>

                <div className="uni-wallet-actions">
                    <button type="button" onClick={() => setSendOpen(true)}>
                        <span><Send aria-hidden="true" /></span>
                        Send
                    </button>
                    <button type="button" onClick={() => setReceiveOpen(true)}>
                        <span><ArrowDownLeft aria-hidden="true" /></span>
                        Receive
                    </button>
                </div>

                <button
                    type="button"
                    className="uni-wallet-outline-action"
                    onClick={() => setView('portfolio')}
                >
                    View portfolio
                    <ArrowRight aria-hidden="true" />
                </button>

                <section className="uni-wallet-activity-section">
                    <h2>Recent activity</h2>

                    <div className="uni-wallet-activity-list">
                        {recentActivity.map((item) => (
                            <ActivityRow
                                key={item.id}
                                activity={item}
                                assets={assets}
                                activeChainId={chainId}
                                activeExplorerUrl={explorerUrl}
                            />
                        ))}
                        {recentActivity.length === 0 && (
                            <div className="uni-wallet-empty-activity">
                                <span><ArrowLeftRight aria-hidden="true" /></span>
                                <strong>
                                    {activityLoading
                                        ? 'Loading activity…'
                                        : activityError
                                            ? 'History temporarily unavailable'
                                            : 'No recent activity'}
                                </strong>
                                <p>
                                    {activityLoading
                                        ? 'Reading confirmed transactions from your networks.'
                                        : activityError
                                            ? 'Local confirmed transactions will still appear here.'
                                            : 'No confirmed transactions were found.'}
                                </p>
                            </div>
                        )}
                    </div>

                    {visibleActivity.length > 3 && (
                        <button
                            type="button"
                            className="uni-wallet-small-outline"
                            onClick={() => setView('activity')}
                        >
                            View all activity
                            <ArrowRight aria-hidden="true" />
                        </button>
                    )}
                </section>
            </>
        )
    }

    function renderPortfolio() {
        return (
            <section className="uni-wallet-inner-view">
                <header>
                    <button
                        type="button"
                        aria-label="Back to wallet overview"
                        onClick={() => setView('overview')}
                    >
                        <ArrowLeft aria-hidden="true" />
                    </button>
                    <div>
                        <h2>Portfolio</h2>
                        <span>{visiblePortfolioAssets.length} assets</span>
                    </div>
                    <button
                        type="button"
                        aria-label="Refresh portfolio"
                        onClick={refreshAssets}
                        disabled={refreshing}
                    >
                        <RefreshCw
                            className={refreshing ? 'spinning' : ''}
                            aria-hidden="true"
                        />
                    </button>
                </header>

                <div className="uni-wallet-portfolio-total">
                    <span>Total balance</span>
                    <strong>{totalValue}</strong>
                </div>

                <div className="uni-wallet-assets-scroll">
                    <WalletAssetList
                        tokens={heldAssets}
                        settings={settings}
                        selectedTokens={selectedTokens}
                    />
                </div>
            </section>
        )
    }

    function renderActivity() {
        return (
            <section className="uni-wallet-inner-view">
                <header>
                    <button
                        type="button"
                        aria-label="Back to wallet overview"
                        onClick={() => setView('overview')}
                    >
                        <ArrowLeft aria-hidden="true" />
                    </button>
                    <div>
                        <h2>Activity</h2>
                        <span>{visibleActivity.length} confirmed transactions</span>
                    </div>
                    <span className="uni-wallet-header-spacer" />
                </header>

                <div className="uni-wallet-all-activity">
                    {visibleActivity.map((item) => (
                        <ActivityRow
                            key={item.id}
                            activity={item}
                            assets={assets}
                            activeChainId={chainId}
                            activeExplorerUrl={explorerUrl}
                        />
                    ))}
                    {visibleActivity.length === 0 && (
                        <div className="uni-wallet-empty-activity">
                            <span><ArrowLeftRight aria-hidden="true" /></span>
                            <strong>
                                {activityLoading
                                    ? 'Loading activity…'
                                    : activityError
                                        ? 'History temporarily unavailable'
                                        : 'No activity yet'}
                            </strong>
                            <p>
                                {activityLoading
                                    ? 'Reading confirmed transactions from your networks.'
                                    : activityError
                                        ? 'Local confirmed transactions will still appear here.'
                                        : 'No confirmed transactions were found.'}
                            </p>
                        </div>
                    )}
                </div>
            </section>
        )
    }

    return (
        <>
            <Dialog.Root open={open} onOpenChange={onOpenChange}>
                <Dialog.Portal>
                    <Dialog.Overlay className="wallet-dialog-overlay uni-wallet-overlay" />
                    <Dialog.Content
                        className="wallet-dialog wallet-account-dialog uni-wallet-dialog"
                        aria-describedby="uni-wallet-description"
                    >
                        <Dialog.Title className="uni-wallet-sr-only">
                            Wallet
                        </Dialog.Title>
                        <Dialog.Description
                            id="uni-wallet-description"
                            className="uni-wallet-sr-only"
                        >
                            Wallet balance, actions, portfolio, and recent activity.
                        </Dialog.Description>

                        <motion.div
                            className="uni-wallet-shell"
                            initial={{ opacity: 0, scale: 0.985, y: -8 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            transition={{
                                duration: 0.18,
                                ease: [0.22, 1, 0.36, 1],
                            }}
                        >
                            {view === 'overview' && renderOverview()}
                            {view === 'portfolio' && renderPortfolio()}
                            {view === 'activity' && renderActivity()}
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
