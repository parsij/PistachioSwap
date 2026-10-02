import { useMemo, useState } from 'react'
import {
    Activity,
    ArrowLeftRight,
    Copy,
    ExternalLink,
    Layers3,
    QrCode,
    RefreshCw,
    Search,
    Send,
} from 'lucide-react'

import TokenIcon from '../../tokens/components/TokenIcon.jsx'
import { WalletAvatar } from '../../wallet/components/wallet/WalletAccountButton.jsx'
import { useWalletActivity } from '../../wallet/hooks/useWalletActivity.js'
import { filterVisibleActivity } from '../../wallet/services/visibleWalletActivity.js'
import {
    filterPortfolioTokens,
    sortWalletAssetsByValue,
} from '../../tokens/services/portfolio.js'
import {
    formatWalletTokenAmount,
    formatWalletUsdValue,
    resolveWalletUsdValue,
} from '../../tokens/services/walletTokens.js'
import {
    getTokenDisplayName,
    getTokenDisplaySymbol,
} from '../../tokens/services/tokenDisplay.js'
import { shortenAddress } from '../../../services/address.js'
import {
    getCuratedEvmChain,
    getCuratedEvmChainLogoUri,
} from '../../../web3/curatedEvmChains.js'

import './PortfolioPage.css'

const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'tokens', label: 'Tokens' },
    { id: 'activity', label: 'Activity' },
]

function hasPositiveBalance(token) {
    const raw = String(token?.rawBalance ?? '')
    if (/^\d+$/.test(raw)) return BigInt(raw) > 0n
    return Number(token?.balance ?? 0) > 0
}

function formatPortfolioTotal(tokens) {
    const total = tokens
        .map(resolveWalletUsdValue)
        .map(Number)
        .filter((value) => Number.isFinite(value) && value >= 0)
        .reduce((sum, value) => sum + value, 0)

    return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(total)
}

function tokenSearchMatch(token, search) {
    const query = search.trim().toLowerCase()
    if (!query) return true
    return [
        token?.name,
        token?.symbol,
        token?.address,
        getCuratedEvmChain(token?.chainId)?.name,
    ].some((value) => String(value ?? '').toLowerCase().includes(query))
}

function activityLabel(type) {
    return {
        swapped: 'Swapped',
        approved: 'Approved',
        sent: 'Sent',
        received: 'Received',
        contract: 'Contract interaction',
    }[type] ?? 'Transaction'
}

function compactAmount(value) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return null
    if (numeric === 0) return '0'
    if (Math.abs(numeric) < 0.001) return '<0.001'
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(numeric)
}

function activitySummary(item) {
    if (item.type === 'swapped') {
        const sell = compactAmount(item.sellAmount)
        const buy = compactAmount(item.buyAmount)
        const sellSymbol = item.sellToken?.symbol
        const buySymbol = item.buyToken?.symbol
        if (sell && sellSymbol && buy && buySymbol) {
            return `${sell} ${sellSymbol} → ${buy} ${buySymbol}`
        }
        return [sellSymbol, buySymbol].filter(Boolean).join(' → ') || 'Swap confirmed'
    }

    const amount = compactAmount(item.amount)
    const symbol = item.token?.symbol
    if (amount && symbol) return `${amount} ${symbol}`
    if (symbol) return symbol
    return item.type === 'contract' ? 'Contract interaction' : 'Transaction confirmed'
}

function activityTime(timestamp) {
    const date = new Date(timestamp)
    if (!Number.isFinite(date.getTime())) return ''
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

function resolveActivityToken(candidate, assets, chainId) {
    if (!candidate) return null
    const address = String(candidate.address ?? '').toLowerCase()
    return assets.find((token) =>
        Number(token.chainId) === Number(chainId) &&
        (
            (address && String(token.address ?? '').toLowerCase() === address) ||
            (!address && candidate.isNative && token.isNative)
        ),
    ) ?? {
        ...candidate,
        chainId,
        address: candidate.address ?? '0x0000000000000000000000000000000000000000',
    }
}

function ActivityIcon({ item, assets }) {
    if (item.type === 'swapped') {
        const sell = resolveActivityToken(item.sellToken, assets, item.chainId)
        const buy = resolveActivityToken(
            item.buyToken,
            assets,
            item.destinationChainId ?? item.chainId,
        )
        if (sell && buy) {
            return (
                <span className="portfolio-activity-pair">
                    <TokenIcon token={sell} size="list" showChainBadge={false} />
                    <TokenIcon token={buy} size="list" showChainBadge={false} />
                </span>
            )
        }
    }

    const token = resolveActivityToken(item.token, assets, item.chainId)
    if (token) return <TokenIcon token={token} size="list" showChainBadge={false} />
    return <Activity aria-hidden="true" />
}

function PortfolioActivityRow({ item, assets }) {
    const chain = getCuratedEvmChain(item.chainId)
    const explorer = chain?.blockExplorers?.default?.url
    const href = explorer && item.hash
        ? `${explorer.replace(/\/+$/, '')}/tx/${item.hash}`
        : null

    const body = (
        <>
            <span className="portfolio-activity-icon">
                <ActivityIcon item={item} assets={assets} />
                {getCuratedEvmChainLogoUri(item.chainId) && (
                    <img
                        className="portfolio-activity-chain"
                        src={getCuratedEvmChainLogoUri(item.chainId)}
                        alt=""
                    />
                )}
            </span>
            <span className="portfolio-activity-copy">
                <strong>{activityLabel(item.type)}</strong>
                <span>{activitySummary(item)}</span>
            </span>
            <time dateTime={item.timestamp}>{activityTime(item.timestamp)}</time>
            {href && <ExternalLink className="portfolio-row-external" aria-hidden="true" />}
        </>
    )

    return href ? (
        <a
            className="portfolio-activity-row"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
        >
            {body}
        </a>
    ) : (
        <div className="portfolio-activity-row">{body}</div>
    )
}

function PortfolioTokenRow({ token }) {
    const chain = getCuratedEvmChain(token.chainId)
    return (
        <div className="portfolio-token-row">
            <TokenIcon token={token} size="list" />
            <span className="portfolio-token-copy">
                <strong>{getTokenDisplayName(token)}</strong>
                <span>{getTokenDisplaySymbol(token)}</span>
            </span>
            <span className="portfolio-token-chain">
                {getCuratedEvmChainLogoUri(token.chainId) && (
                    <img src={getCuratedEvmChainLogoUri(token.chainId)} alt="" />
                )}
                <span>{chain?.name ?? `Chain ${token.chainId}`}</span>
            </span>
            <span className="portfolio-token-balance">
                <strong>{formatWalletUsdValue(token)}</strong>
                <span>{formatWalletTokenAmount(token.balance)} {getTokenDisplaySymbol(token)}</span>
            </span>
        </div>
    )
}

function LoadingRows() {
    return (
        <div className="portfolio-loading" aria-label="Loading activity">
            {Array.from({ length: 4 }).map((_, index) => (
                <div className="portfolio-loading-row" key={index}>
                    <span />
                    <span />
                    <span />
                </div>
            ))}
        </div>
    )
}

function dispatchWalletAction(action) {
    window.dispatchEvent(new CustomEvent('pistachio:open-wallet-action', {
        detail: { action },
    }))
}

export default function PortfolioPage({ wallet }) {
    const {
        walletState,
        walletTokens = [],
        settings = {},
        selectedTokens = [],
        onRefetch,
    } = wallet
    const [tab, setTab] = useState(() => {
        const requested = new URLSearchParams(window.location.search).get('tab')
        return TABS.some((item) => item.id === requested) ? requested : 'overview'
    })
    const [search, setSearch] = useState('')
    const [chainFilter, setChainFilter] = useState('all')
    const [refreshing, setRefreshing] = useState(false)
    const [copied, setCopied] = useState(false)

    const {
        items: activity,
        loading: activityLoading,
        error: activityError,
        refetch: refetchActivity,
    } = useWalletActivity({
        walletAddress: walletState.address,
        enabled: walletState.isConnected,
        limit: 50,
    })

    const heldAssets = useMemo(
        () => walletTokens.filter(hasPositiveBalance),
        [walletTokens],
    )
    const portfolioAssets = useMemo(
        () => sortWalletAssetsByValue(filterPortfolioTokens(heldAssets, {
            ...settings,
            selectedTokens,
        })),
        [heldAssets, selectedTokens, settings],
    )
    const visibleActivity = useMemo(
        () => filterVisibleActivity(activity, walletTokens),
        [activity, walletTokens],
    )
    const filteredAssets = useMemo(
        () => portfolioAssets.filter((token) =>
            (chainFilter === 'all' || Number(token.chainId) === Number(chainFilter)) &&
            tokenSearchMatch(token, search)),
        [chainFilter, portfolioAssets, search],
    )
    const chainIds = useMemo(
        () => [...new Set(portfolioAssets.map((token) => Number(token.chainId)))]
            .filter((chainId) => getCuratedEvmChain(chainId))
            .sort((left, right) =>
                (getCuratedEvmChain(left)?.name ?? '').localeCompare(
                    getCuratedEvmChain(right)?.name ?? '',
                )),
        [portfolioAssets],
    )
    const totalValue = useMemo(
        () => formatPortfolioTotal(portfolioAssets),
        [portfolioAssets],
    )

    function changeTab(nextTab) {
        setTab(nextTab)
        const url = new URL(window.location.href)
        if (nextTab === 'overview') url.searchParams.delete('tab')
        else url.searchParams.set('tab', nextTab)
        window.history.replaceState(window.history.state, '', url)
    }

    async function refresh() {
        if (refreshing) return
        setRefreshing(true)
        try {
            await Promise.all([
                Promise.resolve(onRefetch?.()),
                Promise.resolve(refetchActivity?.()),
            ])
        } finally {
            setRefreshing(false)
        }
    }

    async function copyAddress() {
        try {
            await navigator.clipboard?.writeText(walletState.address)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1400)
        } catch {
            setCopied(false)
        }
    }

    if (!walletState.isConnected) {
        return (
            <section className="portfolio-page portfolio-disconnected">
                <div className="portfolio-empty-card">
                    <WalletAvatar address={null} size="md" />
                    <h2>Your portfolio</h2>
                    <p>Connect a wallet from the header to see balances, tokens, and activity across supported networks.</p>
                </div>
            </section>
        )
    }

    const overviewAssets = portfolioAssets.slice(0, 5)
    const overviewActivity = visibleActivity.slice(0, 5)

    return (
        <section className="portfolio-page">
            <header className="portfolio-header">
                <div className="portfolio-identity">
                    <WalletAvatar address={walletState.address} size="md" />
                    <div>
                        <span>Portfolio</span>
                        <button type="button" onClick={copyAddress}>
                            {shortenAddress(walletState.address, 6)}
                            <Copy aria-hidden="true" />
                            {copied && <small>Copied</small>}
                        </button>
                    </div>
                </div>
                <div className="portfolio-header-actions">
                    <button
                        type="button"
                        className="portfolio-icon-button"
                        aria-label="Refresh portfolio"
                        onClick={refresh}
                        disabled={refreshing}
                    >
                        <RefreshCw className={refreshing ? 'spinning' : ''} aria-hidden="true" />
                    </button>
                </div>
                <nav className="portfolio-tabs" aria-label="Portfolio views">
                    {TABS.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className={tab === item.id ? 'active' : ''}
                            aria-current={tab === item.id ? 'page' : undefined}
                            onClick={() => changeTab(item.id)}
                        >
                            {item.label}
                        </button>
                    ))}
                </nav>
            </header>

            {tab === 'overview' && (
                <div className="portfolio-overview">
                    <section className="portfolio-balance-card">
                        <span className="portfolio-eyebrow">Portfolio balance</span>
                        <strong className="portfolio-total">{totalValue}</strong>
                        <span className="portfolio-subtitle">
                            {portfolioAssets.length} {portfolioAssets.length === 1 ? 'asset' : 'assets'} across {chainIds.length || 1} {chainIds.length === 1 ? 'network' : 'networks'}
                        </span>
                    </section>

                    <div className="portfolio-action-grid" aria-label="Portfolio actions">
                        <a className="portfolio-action-tile" href="/swap/">
                            <ArrowLeftRight aria-hidden="true" />
                            <span>Trade</span>
                        </a>
                        <button type="button" className="portfolio-action-tile" onClick={() => dispatchWalletAction('send')}>
                            <Send aria-hidden="true" />
                            <span>Send</span>
                        </button>
                        <button type="button" className="portfolio-action-tile" onClick={() => dispatchWalletAction('receive')}>
                            <QrCode aria-hidden="true" />
                            <span>Receive</span>
                        </button>
                        <button type="button" className="portfolio-action-tile" onClick={() => changeTab('tokens')}>
                            <Layers3 aria-hidden="true" />
                            <span>Tokens</span>
                        </button>
                    </div>

                    <div className="portfolio-overview-grid">
                        <section className="portfolio-card portfolio-assets-card">
                            <div className="portfolio-card-header">
                                <h2>Tokens</h2>
                                <button type="button" onClick={() => changeTab('tokens')}>View all</button>
                            </div>
                            {overviewAssets.length > 0 ? (
                                <div className="portfolio-token-list">
                                    {overviewAssets.map((token) => (
                                        <PortfolioTokenRow
                                            key={`${token.chainId}:${token.address}`}
                                            token={token}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <p className="portfolio-empty-copy">No visible token balances yet.</p>
                            )}
                        </section>

                        <section className="portfolio-card portfolio-activity-card">
                            <div className="portfolio-card-header">
                                <h2>Activity</h2>
                                <button type="button" onClick={() => changeTab('activity')}>View all</button>
                            </div>
                            {activityLoading && overviewActivity.length === 0 ? (
                                <LoadingRows />
                            ) : overviewActivity.length > 0 ? (
                                <div className="portfolio-activity-list">
                                    {overviewActivity.map((item) => (
                                        <PortfolioActivityRow
                                            key={item.id}
                                            item={item}
                                            assets={walletTokens}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <p className="portfolio-empty-copy">No recent activity.</p>
                            )}
                        </section>
                    </div>
                </div>
            )}

            {tab === 'tokens' && (
                <section className="portfolio-card portfolio-full-card">
                    <div className="portfolio-list-toolbar">
                        <div>
                            <h2>Tokens</h2>
                            <span>{portfolioAssets.length} visible assets</span>
                        </div>
                        <div className="portfolio-token-filters">
                            <label className="portfolio-token-search">
                                <Search aria-hidden="true" />
                                <span className="portfolio-visually-hidden">Search portfolio tokens</span>
                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Search tokens"
                                    autoComplete="off"
                                    spellCheck="false"
                                />
                            </label>
                            <select
                                value={chainFilter}
                                onChange={(event) => setChainFilter(event.target.value)}
                                aria-label="Filter portfolio by network"
                            >
                                <option value="all">All networks</option>
                                {chainIds.map((chainId) => (
                                    <option key={chainId} value={chainId}>
                                        {getCuratedEvmChain(chainId)?.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                    {filteredAssets.length > 0 ? (
                        <div className="portfolio-token-list portfolio-token-list-full">
                            {filteredAssets.map((token) => (
                                <PortfolioTokenRow
                                    key={`${token.chainId}:${token.address}`}
                                    token={token}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="portfolio-empty-inline">
                            <Search aria-hidden="true" />
                            <p>{search || chainFilter !== 'all' ? 'No matching tokens.' : 'No visible token balances yet.'}</p>
                        </div>
                    )}
                </section>
            )}

            {tab === 'activity' && (
                <section className="portfolio-card portfolio-full-card">
                    <div className="portfolio-list-toolbar">
                        <div>
                            <h2>Activity</h2>
                            <span>Recent wallet activity across supported networks</span>
                        </div>
                        <button
                            type="button"
                            className="portfolio-refresh-button"
                            onClick={refresh}
                            disabled={refreshing}
                        >
                            <RefreshCw className={refreshing ? 'spinning' : ''} aria-hidden="true" />
                            Refresh
                        </button>
                    </div>
                    {activityError && <p className="portfolio-inline-notice">{activityError}</p>}
                    {activityLoading && visibleActivity.length === 0 ? (
                        <LoadingRows />
                    ) : visibleActivity.length > 0 ? (
                        <div className="portfolio-activity-list portfolio-activity-list-full">
                            {visibleActivity.map((item) => (
                                <PortfolioActivityRow
                                    key={item.id}
                                    item={item}
                                    assets={walletTokens}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="portfolio-empty-inline">
                            <Activity aria-hidden="true" />
                            <p>No wallet activity yet.</p>
                        </div>
                    )}
                </section>
            )}
        </section>
    )
}
