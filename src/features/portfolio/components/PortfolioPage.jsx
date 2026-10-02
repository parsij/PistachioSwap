import { useEffect, useMemo, useRef, useState } from 'react'
import {
    Activity,
    ArrowDownCircle,
    ArrowLeftRight,
    ArrowRight,
    ChevronDown,
    Copy,
    ExternalLink,
    MoreHorizontal,
    Landmark,
    RefreshCw,
    Search,
    Send,
    Share2,
} from 'lucide-react'

import TokenIcon from '../../tokens/components/TokenIcon.jsx'
import { WalletAvatar } from '../../wallet/components/wallet/WalletAccountButton.jsx'
import { useWalletActivity } from '../../wallet/hooks/useWalletActivity.js'
import { filterVisibleActivity } from '../../wallet/services/visibleWalletActivity.js'
import { useWalletTokens } from '../../tokens/hooks/useWalletTokens.js'
import {
    filterPortfolioTokens,
    getHiddenPortfolioTokens,
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
    CURATED_EVM_CHAINS,
    getCuratedEvmChain,
    getCuratedEvmChainLogoUri,
} from '../../../web3/curatedEvmChains.js'
import {
    PORTFOLIO_CHART_PERIODS,
    portfolioSnapshotChange,
    readPortfolioSnapshots,
    recordPortfolioSnapshot,
} from '../services/portfolioHistory.js'

import './PortfolioPage.css'

const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'tokens', label: 'Tokens' },
    { id: 'nfts', label: 'NFTs' },
    { id: 'activity', label: 'Activity' },
]

const TOKEN_SORTS = new Set(['name', 'price', 'balance', 'value', 'change', 'allocation'])
const ACTIVITY_TYPES = ['all', 'swapped', 'sent', 'received', 'approved', 'contract']

function normalizeAddress(value) {
    const address = String(value ?? '').trim().toLowerCase()
    return /^0x[a-f0-9]{40}$/.test(address) ? address : null
}

function hasPositiveBalance(token) {
    const raw = String(token?.rawBalance ?? '')
    if (/^\d+$/.test(raw)) return BigInt(raw) > 0n
    return Number(token?.balance ?? token?.formattedBalance ?? 0) > 0
}

function resolveTokenPrice(token) {
    for (const candidate of [
        token?.trustedPriceUSD,
        token?.marketPriceUSD,
        token?.priceUSD,
    ]) {
        const value = Number(candidate)
        if (Number.isFinite(value) && value >= 0) return value
    }

    const value = Number(resolveWalletUsdValue(token))
    const balance = Number(token?.balance ?? token?.formattedBalance)
    if (Number.isFinite(value) && Number.isFinite(balance) && balance > 0) {
        return value / balance
    }
    return null
}

function resolveTokenChange(token) {
    const value = Number(token?.priceChange24hPercent)
    return Number.isFinite(value) ? value : null
}

function numericPortfolioTotal(tokens) {
    return tokens
        .map(resolveWalletUsdValue)
        .map(Number)
        .filter((value) => Number.isFinite(value) && value >= 0)
        .reduce((sum, value) => sum + value, 0)
}

function formatUsd(value, maximumFractionDigits = 2) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return '—'
    if (numeric > 0 && numeric < 0.01) return '<$0.01'

    const safeMaximumFractionDigits = Math.min(
        20,
        Math.max(0, Math.trunc(Number(maximumFractionDigits) || 0)),
    )

    return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: Math.min(2, safeMaximumFractionDigits),
        maximumFractionDigits: safeMaximumFractionDigits,
    }).format(numeric)
}

function formatPrice(value) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return '—'
    if (numeric > 0 && numeric < 0.000001) return '<$0.000001'
    if (numeric > 0 && numeric < 0.01) {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 6,
        }).format(numeric)
    }
    return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(numeric)
}

function formatPercent(value, signed = false) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return '—'
    const prefix = signed && numeric > 0 ? '+' : ''
    return prefix + numeric.toFixed(Math.abs(numeric) >= 100 ? 0 : 2) + '%'
}

function formatSignedUsd(value) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return '—'
    const prefix = numeric > 0 ? '+' : numeric < 0 ? '-' : ''
    return prefix + formatUsd(Math.abs(numeric))
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
            return sell + ' ' + sellSymbol + ' → ' + buy + ' ' + buySymbol
        }
        return [sellSymbol, buySymbol].filter(Boolean).join(' → ') || 'Swap confirmed'
    }

    const amount = compactAmount(item.amount)
    const symbol = item.token?.symbol
    if (amount && symbol) return amount + ' ' + symbol
    if (symbol) return symbol
    return item.type === 'contract' ? 'Contract interaction' : 'Transaction confirmed'
}

function activityTime(timestamp) {
    const date = new Date(timestamp)
    if (!Number.isFinite(date.getTime())) return ''
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
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
                <span className="uni-portfolio-activity-pair">
                    <TokenIcon token={sell} size="list" showChainBadge={false} />
                    <TokenIcon token={buy} size="list" showChainBadge={false} />
                </span>
            )
        }
    }

    const token = resolveActivityToken(item.token, assets, item.chainId)
    return token
        ? <TokenIcon token={token} size="list" showChainBadge={false} />
        : <Activity aria-hidden="true" />
}

function useOutsideDismiss(open, ref, close) {
    useEffect(() => {
        if (!open) return undefined
        const handler = (event) => {
            if (ref.current?.contains(event.target)) return
            close()
        }
        document.addEventListener('pointerdown', handler, true)
        return () => document.removeEventListener('pointerdown', handler, true)
    }, [close, open, ref])
}

function NetworkFilter({ value, onChange, chainIds }) {
    const [open, setOpen] = useState(false)
    const ref = useRef(null)
    useOutsideDismiss(open, ref, () => setOpen(false))
    const selected = value === 'all' ? null : getCuratedEvmChain(value)

    return (
        <div className="uni-portfolio-network" ref={ref}>
            <button
                type="button"
                className="uni-portfolio-control-button uni-portfolio-network-trigger"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
            >
                <span className="uni-portfolio-network-icons" aria-hidden="true">
                    {selected ? (
                        getCuratedEvmChainLogoUri(selected.id) && (
                            <img src={getCuratedEvmChainLogoUri(selected.id)} alt="" />
                        )
                    ) : (
                        chainIds.slice(0, 4).map((chainId, index) => (
                            getCuratedEvmChainLogoUri(chainId) && (
                                <img
                                    key={chainId}
                                    src={getCuratedEvmChainLogoUri(chainId)}
                                    alt=""
                                    style={{ zIndex: 5 - index }}
                                />
                            )
                        ))
                    )}
                </span>
                <span>{selected?.name ?? 'All networks'}</span>
                <ChevronDown aria-hidden="true" />
            </button>
            {open && (
                <div className="uni-portfolio-network-menu" role="listbox" aria-label="Portfolio network">
                    <button
                        type="button"
                        role="option"
                        aria-selected={value === 'all'}
                        onClick={() => {
                            onChange('all')
                            setOpen(false)
                        }}
                    >
                        <span className="uni-portfolio-network-all">◎</span>
                        <span>All networks</span>
                    </button>
                    {CURATED_EVM_CHAINS.map((chain) => (
                        <button
                            key={chain.id}
                            type="button"
                            role="option"
                            aria-selected={Number(value) === Number(chain.id)}
                            onClick={() => {
                                onChange(chain.id)
                                setOpen(false)
                            }}
                        >
                            {getCuratedEvmChainLogoUri(chain.id) ? (
                                <img src={getCuratedEvmChainLogoUri(chain.id)} alt="" />
                            ) : (
                                <span className="uni-portfolio-network-fallback" />
                            )}
                            <span>{chain.name}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

function MoreMenu({ address, onRefresh }) {
    const [open, setOpen] = useState(false)
    const ref = useRef(null)
    useOutsideDismiss(open, ref, () => setOpen(false))
    const chain = getCuratedEvmChain(1)
    const explorer = chain?.blockExplorers?.default?.url

    return (
        <div className="uni-portfolio-more" ref={ref}>
            <button
                type="button"
                className="uni-portfolio-more-trigger"
                aria-label="Portfolio options"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
            >
                <MoreHorizontal aria-hidden="true" />
            </button>
            {open && (
                <div className="uni-portfolio-menu" role="menu">
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                            navigator.clipboard?.writeText(address)
                            setOpen(false)
                        }}
                    >
                        <Copy aria-hidden="true" />
                        Copy address
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                            onRefresh()
                            setOpen(false)
                        }}
                    >
                        <RefreshCw aria-hidden="true" />
                        Refresh
                    </button>
                    {explorer && (
                        <a
                            role="menuitem"
                            href={explorer.replace(/\/+$/, '') + '/address/' + address}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setOpen(false)}
                        >
                            <ExternalLink aria-hidden="true" />
                            View explorer
                        </a>
                    )}
                </div>
            )}
        </div>
    )
}

function goToTrade() {
    const url = new URL(window.location.href)
    url.pathname = '/swap/'
    url.searchParams.delete('view')
    url.searchParams.delete('address')
    url.searchParams.delete('tab')
    url.searchParams.delete('network')
    window.history.pushState(window.history.state, '', url)
    window.dispatchEvent(new CustomEvent('pistachio:navigate-app', {
        detail: { view: 'trade' },
    }))
}

function dispatchWalletAction(action) {
    window.dispatchEvent(new CustomEvent('pistachio:open-wallet-action', {
        detail: { action },
    }))
}

function ActionTile({ icon: Icon, label, onClick, children }) {
    return (
        <div className="uni-portfolio-action-wrap">
            <button type="button" className="uni-portfolio-action-tile" onClick={onClick}>
                <Icon aria-hidden="true" />
                <span>{label}</span>
            </button>
            {children}
        </div>
    )
}

function ActionTiles({ ownWallet, address, onRefresh }) {
    const [moreOpen, setMoreOpen] = useState(false)

    if (!ownWallet) {
        return (
            <div className="uni-portfolio-action-grid two">
                <ActionTile
                    icon={Copy}
                    label="Copy"
                    onClick={() => navigator.clipboard?.writeText(address)}
                />
                <ActionTile
                    icon={ArrowLeftRight}
                    label="Trade"
                    onClick={goToTrade}
                />
            </div>
        )
    }

    return (
        <div className="uni-portfolio-action-grid">
            <ActionTile
                icon={Send}
                label="Send"
                onClick={() => dispatchWalletAction('send')}
            />
            <ActionTile
                icon={ArrowDownCircle}
                label="Receive"
                onClick={() => dispatchWalletAction('receive')}
            />
            <ActionTile
                icon={Landmark}
                label="Buy"
                onClick={goToTrade}
            />
            <ActionTile
                icon={MoreHorizontal}
                label="More"
                onClick={() => setMoreOpen((current) => !current)}
            >
                {moreOpen && (
                    <div className="uni-portfolio-action-menu">
                        <button type="button" onClick={goToTrade}>
                            <ArrowLeftRight aria-hidden="true" /> Swap
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                onRefresh()
                                setMoreOpen(false)
                            }}
                        >
                            <RefreshCw aria-hidden="true" /> Refresh
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                navigator.clipboard?.writeText(address)
                                setMoreOpen(false)
                            }}
                        >
                            <Copy aria-hidden="true" /> Copy address
                        </button>
                    </div>
                )}
            </ActionTile>
        </div>
    )
}

function historyDateLabel(timestamp, period) {
    const options = period === '1H' || period === '1D'
        ? { hour: 'numeric', minute: '2-digit' }
        : { month: 'short', day: 'numeric' }
    return new Intl.DateTimeFormat(undefined, options).format(new Date(timestamp))
}

function PortfolioChart({ points, currentValue, period, onPeriodChange }) {
    const width = 820
    const height = 300
    const top = 18
    const bottom = 28
    const right = 54
    const plotWidth = width - right
    const plotHeight = height - top - bottom
    const values = points.map((point) => Number(point.value)).filter(Number.isFinite)
    const latest = values.at(-1) ?? currentValue
    const rawMin = values.length ? Math.min(...values) : latest
    const rawMax = values.length ? Math.max(...values) : latest
    const span = Math.max(rawMax - rawMin, Math.max(Math.abs(latest) * 0.05, 0.01))
    const min = Math.max(0, rawMin - span * 0.18)
    const max = rawMax + span * 0.18
    const timeMin = points[0]?.time ?? Date.now()
    const timeMax = points.at(-1)?.time ?? Date.now()
    const timeSpan = Math.max(timeMax - timeMin, 1)
    const x = (point) => points.length === 1
        ? plotWidth - 6
        : ((point.time - timeMin) / timeSpan) * plotWidth
    const y = (point) => top + ((max - point.value) / Math.max(max - min, 0.000001)) * plotHeight
    const line = points.length >= 2
        ? points.map((point, index) => (index ? 'L' : 'M') + x(point).toFixed(2) + ' ' + y(point).toFixed(2)).join(' ')
        : ''
    const area = line
        ? line + ' L ' + x(points.at(-1)).toFixed(2) + ' ' + (top + plotHeight) +
            ' L ' + x(points[0]).toFixed(2) + ' ' + (top + plotHeight) + ' Z'
        : ''
    const change = portfolioSnapshotChange(points)
    const positive = !change || change.absolute >= 0
    const axis = [max, min + (max - min) * 0.66, min + (max - min) * 0.33, min]
    const labels = points.length >= 2
        ? [
            points[0],
            points[Math.floor((points.length - 1) / 3)],
            points[Math.floor(((points.length - 1) * 2) / 3)],
            points.at(-1),
        ]
        : []

    return (
        <div className="uni-portfolio-chart-block">
            <div className="uni-portfolio-chart-canvas" data-positive={positive ? 'true' : 'false'}>
                <svg
                    viewBox={'0 0 ' + width + ' ' + height}
                    preserveAspectRatio="none"
                    role="img"
                    aria-label="Portfolio value history"
                >
                    <defs>
                        <linearGradient id="portfolio-area-gradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="currentColor" stopOpacity="0.26" />
                            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    {area && <path className="uni-portfolio-chart-area" d={area} />}
                    {line && <path className="uni-portfolio-chart-line" d={line} />}
                    {points.length > 0 && (
                        <circle
                            className="uni-portfolio-chart-dot"
                            cx={x(points.at(-1))}
                            cy={y(points.at(-1))}
                            r="5"
                        />
                    )}
                </svg>
                <div className="uni-portfolio-chart-y-axis" aria-hidden="true">
                    {axis.map((value, index) => (
                        <span key={index}>{formatUsd(Math.max(0, value), 0)}</span>
                    ))}
                </div>
                {labels.length > 0 && (
                    <div className="uni-portfolio-chart-x-axis" aria-hidden="true">
                        {labels.map((point, index) => (
                            <span key={index}>{historyDateLabel(point.time, period)}</span>
                        ))}
                    </div>
                )}
                {points.length < 2 && (
                    <div className="uni-portfolio-chart-empty-copy">
                        Portfolio history starts building from this browser.
                    </div>
                )}
            </div>
            <div className="uni-portfolio-periods" aria-label="Portfolio chart period">
                {PORTFOLIO_CHART_PERIODS.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        className={period === item.id ? 'active' : ''}
                        onClick={() => onPeriodChange(item.id)}
                    >
                        {item.label}
                    </button>
                ))}
            </div>
        </div>
    )
}

function PerformancePanel() {
    const [period, setPeriod] = useState('All')
    const [open, setOpen] = useState(false)
    const ref = useRef(null)
    useOutsideDismiss(open, ref, () => setOpen(false))

    return (
        <section className="uni-portfolio-performance">
            <div className="uni-portfolio-performance-header">
                <h2>
                    Performance
                    <span title="Cost-basis profit and loss is not available from PistachioSwap's current portfolio data.">i</span>
                </h2>
                <div className="uni-portfolio-performance-period" ref={ref}>
                    <button
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={open}
                        onClick={() => setOpen((current) => !current)}
                    >
                        {period} <ChevronDown aria-hidden="true" />
                    </button>
                    {open && (
                        <div role="menu">
                            {['All', '1M', '1W', '1D'].map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                        setPeriod(item)
                                        setOpen(false)
                                    }}
                                >
                                    {item}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <dl title="Profit and loss needs cost-basis data that PistachioSwap does not currently index.">
                <div>
                    <dt>Unrealized return</dt>
                    <dd>—</dd>
                </div>
                <div>
                    <dt>Realized return</dt>
                    <dd>—</dd>
                </div>
                <div>
                    <dt>Total return</dt>
                    <dd>—</dd>
                </div>
            </dl>
        </section>
    )
}

function TokenTable({
    tokens,
    totalValue,
    compact = false,
    sortKey,
    sortDirection,
    onSort,
}) {
    const rows = useMemo(() => {
        const next = tokens.map((token) => {
            const value = Number(resolveWalletUsdValue(token))
            const price = resolveTokenPrice(token)
            const balance = Number(token?.balance ?? token?.formattedBalance)
            const change = resolveTokenChange(token)
            const allocation = totalValue > 0 && Number.isFinite(value)
                ? (value / totalValue) * 100
                : null
            return { token, value, price, balance, change, allocation }
        })

        if (!sortKey) return next
        const direction = sortDirection === 'asc' ? 1 : -1
        return next.toSorted((left, right) => {
            if (sortKey === 'name') {
                return getTokenDisplayName(left.token).localeCompare(getTokenDisplayName(right.token)) * direction
            }
            const a = Number(left[sortKey])
            const b = Number(right[sortKey])
            if (!Number.isFinite(a) && !Number.isFinite(b)) return 0
            if (!Number.isFinite(a)) return 1
            if (!Number.isFinite(b)) return -1
            return (a - b) * direction
        })
    }, [sortDirection, sortKey, tokens, totalValue])

    function HeaderButton({ id, children }) {
        if (compact || !onSort) return <span>{children}</span>
        return (
            <button type="button" onClick={() => onSort(id)}>
                {children}
                {sortKey === id ? <small>{sortDirection === 'asc' ? '↑' : '↓'}</small> : null}
            </button>
        )
    }

    return (
        <div className={'uni-portfolio-token-table-wrap' + (compact ? ' compact' : '')}>
            <div className="uni-portfolio-token-table">
                <div className="uni-portfolio-token-table-head">
                    <HeaderButton id="name">Token</HeaderButton>
                    <HeaderButton id="price">Price</HeaderButton>
                    <HeaderButton id="balance">Balance</HeaderButton>
                    <HeaderButton id="value">Value</HeaderButton>
                    <HeaderButton id="change">{compact ? 'Unrealized P/L' : '1D'}</HeaderButton>
                    {!compact && <HeaderButton id="allocation">Allocation</HeaderButton>}
                </div>
                {rows.map(({ token, value, price, change, allocation }) => (
                    <div className="uni-portfolio-token-row" key={Number(token.chainId) + ':' + token.address}>
                        <div className="uni-portfolio-token-info">
                            <TokenIcon token={token} size="list" />
                            <span>
                                <strong>{getTokenDisplayName(token)}</strong>
                                <small>{getTokenDisplaySymbol(token)}</small>
                            </span>
                        </div>
                        <span>{formatPrice(price)}</span>
                        <span>
                            {formatWalletTokenAmount(token.balance)} {getTokenDisplaySymbol(token)}
                        </span>
                        <strong>{Number.isFinite(value) ? formatUsd(value) : formatWalletUsdValue(token)}</strong>
                        <span className="uni-portfolio-change" data-positive={!compact && change !== null ? String(change >= 0) : undefined}>
                            {compact ? '—' : change === null ? '—' : formatPercent(change, true)}
                        </span>
                        {!compact && (
                            <span>{allocation === null ? '—' : formatPercent(allocation)}</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}

function ActivityRow({ item, assets }) {
    const chain = getCuratedEvmChain(item.chainId)
    const explorer = chain?.blockExplorers?.default?.url
    const href = explorer && item.hash
        ? explorer.replace(/\/+$/, '') + '/tx/' + item.hash
        : null
    const row = (
        <>
            <span className="uni-portfolio-activity-icon">
                <ActivityIcon item={item} assets={assets} />
                {getCuratedEvmChainLogoUri(item.chainId) && (
                    <img src={getCuratedEvmChainLogoUri(item.chainId)} alt="" />
                )}
            </span>
            <span className="uni-portfolio-activity-copy">
                <strong>{activityLabel(item.type)}</strong>
                <small>{activitySummary(item)}</small>
            </span>
            <span className="uni-portfolio-activity-network">{chain?.name ?? 'Chain ' + item.chainId}</span>
            <time dateTime={item.timestamp}>{activityTime(item.timestamp)}</time>
            {href && <ExternalLink aria-hidden="true" />}
        </>
    )
    return href ? (
        <a className="uni-portfolio-activity-row" href={href} target="_blank" rel="noopener noreferrer">
            {row}
        </a>
    ) : (
        <div className="uni-portfolio-activity-row">{row}</div>
    )
}

function Overview({
    address,
    ownWallet,
    assets,
    allAssets,
    activity,
    totalValue,
    snapshots,
    period,
    setPeriod,
    change,
    onRefresh,
    onTab,
}) {
    const miniAssets = assets.slice(0, 8)
    return (
        <div className="uni-portfolio-overview">
            <div className="uni-portfolio-hero">
                <section className="uni-portfolio-chart-column">
                    <div className="uni-portfolio-balance-header">
                        <strong>{formatUsd(totalValue)}</strong>
                        <span data-positive={change ? String(change.absolute >= 0) : undefined}>
                            {change
                                ? formatSignedUsd(change.absolute) + ' (' + formatPercent(change.percent ?? 0) + ') this ' + (period === 'ALL' ? 'period' : period.toLowerCase())
                                : 'Portfolio history is building'}
                        </span>
                    </div>
                    <PortfolioChart
                        points={snapshots}
                        currentValue={totalValue}
                        period={period}
                        onPeriodChange={setPeriod}
                    />
                </section>

                <aside className="uni-portfolio-right-rail">
                    <ActionTiles
                        ownWallet={ownWallet}
                        address={address}
                        onRefresh={onRefresh}
                    />
                    <PerformancePanel />
                </aside>
            </div>

            <div className="uni-portfolio-separator" />

            <div className="uni-portfolio-overview-tables">
                <section className="uni-portfolio-overview-main">
                    <div className="uni-portfolio-section-title">
                        <div>
                            <h2>Tokens</h2>
                            <span>{assets.length} {assets.length === 1 ? 'token' : 'tokens'}</span>
                        </div>
                    </div>
                    {miniAssets.length > 0 ? (
                        <TokenTable
                            tokens={miniAssets}
                            totalValue={totalValue}
                            compact
                        />
                    ) : (
                        <div className="uni-portfolio-empty-row">No visible token balances.</div>
                    )}
                    {assets.length > 0 && (
                        <button
                            type="button"
                            className="uni-portfolio-view-all"
                            onClick={() => onTab('tokens')}
                        >
                            View all tokens <ArrowRight aria-hidden="true" />
                        </button>
                    )}
                </section>

                <aside className="uni-portfolio-overview-side">
                    <div className="uni-portfolio-section-title">
                        <div>
                            <h2>Activity</h2>
                            <span>Recent transactions</span>
                        </div>
                    </div>
                    <div className="uni-portfolio-mini-activity">
                        {activity.slice(0, 5).map((item) => (
                            <ActivityRow key={item.id} item={item} assets={allAssets} />
                        ))}
                        {activity.length === 0 && (
                            <div className="uni-portfolio-empty-row">No recent activity.</div>
                        )}
                    </div>
                    {activity.length > 5 && (
                        <button
                            type="button"
                            className="uni-portfolio-view-all"
                            onClick={() => onTab('activity')}
                        >
                            View all activity <ArrowRight aria-hidden="true" />
                        </button>
                    )}
                </aside>
            </div>
        </div>
    )
}

export default function PortfolioPage({ wallet }) {
    const {
        walletState,
        walletTokens = [],
        settings = {},
        selectedTokens = [],
        onRefetch,
    } = wallet
    const [, setRouteRevision] = useState(0)

    useEffect(() => {
        const syncRoute = () => setRouteRevision((revision) => revision + 1)
        window.addEventListener('popstate', syncRoute)
        window.addEventListener('pistachio:navigate-app', syncRoute)
        return () => {
            window.removeEventListener('popstate', syncRoute)
            window.removeEventListener('pistachio:navigate-app', syncRoute)
        }
    }, [])

    const params = new URLSearchParams(window.location.search)
    const requestedAddress = normalizeAddress(params.get('address'))
    const connectedAddress = normalizeAddress(walletState.address)
    const address = requestedAddress ?? connectedAddress
    const ownWallet = Boolean(address && connectedAddress && address === connectedAddress)

    const externalWallet = useWalletTokens({
        chainId: 'all',
        walletAddress: address,
        enabled: Boolean(address && !ownWallet),
    })
    const activeWalletTokens = ownWallet ? walletTokens : externalWallet.tokens

    const [tab, setTab] = useState(() => {
        const requested = new URLSearchParams(window.location.search).get('tab')
        return TABS.some((item) => item.id === requested) ? requested : 'overview'
    })
    const [chainFilter, setChainFilter] = useState(() => {
        const value = new URLSearchParams(window.location.search).get('network')
        const parsed = Number(value)
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 'all'
    })
    const [tokenSearch, setTokenSearch] = useState('')
    const [activitySearch, setActivitySearch] = useState('')
    const [activityType, setActivityType] = useState('all')
    const [sortKey, setSortKey] = useState('value')
    const [sortDirection, setSortDirection] = useState('desc')
    const [period, setPeriod] = useState('1M')
    const [historyRevision, setHistoryRevision] = useState(0)
    const [refreshing, setRefreshing] = useState(false)
    const [shareNotice, setShareNotice] = useState('')

    const {
        items: walletActivity,
        loading: activityLoading,
        error: activityError,
        refetch: refetchActivity,
    } = useWalletActivity({
        walletAddress: address,
        enabled: Boolean(address),
        limit: 100,
    })

    const heldAssets = useMemo(
        () => activeWalletTokens.filter(hasPositiveBalance),
        [activeWalletTokens],
    )
    const trustedAssets = useMemo(
        () => sortWalletAssetsByValue(filterPortfolioTokens(heldAssets, {
            ...settings,
            selectedTokens: ownWallet ? selectedTokens : [],
        })),
        [heldAssets, ownWallet, selectedTokens, settings],
    )
    const hiddenAssets = useMemo(
        () => getHiddenPortfolioTokens(heldAssets),
        [heldAssets],
    )
    const assets = useMemo(
        () => chainFilter === 'all'
            ? trustedAssets
            : trustedAssets.filter((token) => Number(token.chainId) === Number(chainFilter)),
        [chainFilter, trustedAssets],
    )
    const totalValue = useMemo(() => numericPortfolioTotal(assets), [assets])
    const visibleActivity = useMemo(
        () => filterVisibleActivity(walletActivity, activeWalletTokens)
            .filter((item) => chainFilter === 'all' || Number(item.chainId) === Number(chainFilter)),
        [activeWalletTokens, chainFilter, walletActivity],
    )
    const chainIds = useMemo(
        () => [...new Set(trustedAssets.map((token) => Number(token.chainId)))]
            .filter((chainId) => getCuratedEvmChain(chainId)),
        [trustedAssets],
    )
    const filteredTokens = useMemo(() => {
        const query = tokenSearch.trim().toLowerCase()
        if (!query) return assets
        return assets.filter((token) => [
            token.name,
            token.symbol,
            token.address,
            getCuratedEvmChain(token.chainId)?.name,
        ].some((value) => String(value ?? '').toLowerCase().includes(query)))
    }, [assets, tokenSearch])
    const filteredActivity = useMemo(() => {
        const query = activitySearch.trim().toLowerCase()
        return visibleActivity.filter((item) => {
            if (activityType !== 'all' && item.type !== activityType) return false
            if (!query) return true
            return [
                activityLabel(item.type),
                activitySummary(item),
                item.hash,
                getCuratedEvmChain(item.chainId)?.name,
            ].some((value) => String(value ?? '').toLowerCase().includes(query))
        })
    }, [activitySearch, activityType, visibleActivity])

    const historyScope = chainFilter === 'all' ? 'all' : String(chainFilter)
    const snapshots = useMemo(
        () => readPortfolioSnapshots({
            walletAddress: address,
            scope: historyScope,
            period,
        }),
        [address, historyRevision, historyScope, period],
    )
    const periodChange = useMemo(() => portfolioSnapshotChange(snapshots), [snapshots])

    useEffect(() => {
        if (!address || !Number.isFinite(totalValue)) return
        if (recordPortfolioSnapshot({
            walletAddress: address,
            scope: historyScope,
            valueUSD: totalValue,
        })) {
            setHistoryRevision((revision) => revision + 1)
        }
    }, [address, historyScope, totalValue])

    useEffect(() => {
        if (!shareNotice) return undefined
        const timeout = window.setTimeout(() => setShareNotice(''), 1600)
        return () => window.clearTimeout(timeout)
    }, [shareNotice])

    function changeTab(nextTab) {
        setTab(nextTab)
        const url = new URL(window.location.href)
        if (nextTab === 'overview') url.searchParams.delete('tab')
        else url.searchParams.set('tab', nextTab)
        window.history.replaceState(window.history.state, '', url)
    }

    function changeNetwork(nextChain) {
        setChainFilter(nextChain)
        const url = new URL(window.location.href)
        if (nextChain === 'all') url.searchParams.delete('network')
        else url.searchParams.set('network', String(nextChain))
        window.history.replaceState(window.history.state, '', url)
    }

    function changeSort(nextKey) {
        if (!TOKEN_SORTS.has(nextKey)) return
        if (sortKey === nextKey) {
            setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc')
        } else {
            setSortKey(nextKey)
            setSortDirection(nextKey === 'name' ? 'asc' : 'desc')
        }
    }

    async function refresh() {
        if (refreshing) return
        setRefreshing(true)
        try {
            await Promise.all([
                Promise.resolve(ownWallet ? onRefetch?.() : externalWallet.refetch?.()),
                Promise.resolve(refetchActivity?.()),
            ])
        } finally {
            setRefreshing(false)
        }
    }

    async function sharePortfolio() {
        const url = window.location.href
        try {
            if (navigator.share) {
                await navigator.share({
                    title: 'PistachioSwap Portfolio',
                    url,
                })
                return
            }
            await navigator.clipboard?.writeText(url)
            setShareNotice('Link copied')
        } catch {
            setShareNotice('')
        }
    }

    if (!address) {
        return (
            <section className="uni-portfolio-page uni-portfolio-disconnected">
                <div className="uni-portfolio-connect-card">
                    <WalletAvatar address={null} size="md" />
                    <h2>Your portfolio</h2>
                    <p>Connect a wallet from the header to view tokens and activity.</p>
                </div>
            </section>
        )
    }

    return (
        <section className="uni-portfolio-page">
            <header className="uni-portfolio-header">
                <div className="uni-portfolio-header-top">
                    <div className="uni-portfolio-address">
                        <WalletAvatar address={address} size="md" />
                        <strong>{shortenAddress(address, 5)}</strong>
                    </div>
                    <div className="uni-portfolio-header-controls">
                        <MoreMenu address={address} onRefresh={refresh} />
                        <button
                            type="button"
                            className="uni-portfolio-control-button"
                            onClick={sharePortfolio}
                        >
                            <Share2 aria-hidden="true" />
                            <span>Share</span>
                        </button>
                        <NetworkFilter
                            value={chainFilter}
                            onChange={changeNetwork}
                            chainIds={chainIds}
                        />
                    </div>
                </div>

                <nav className="uni-portfolio-tabs" aria-label="Portfolio views">
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
                {shareNotice && <span className="uni-portfolio-toast">{shareNotice}</span>}
            </header>

            <div className="uni-portfolio-content">
                {tab === 'overview' && (
                    <Overview
                        address={address}
                        ownWallet={ownWallet}
                        assets={assets}
                        allAssets={activeWalletTokens}
                        activity={visibleActivity}
                        totalValue={totalValue}
                        snapshots={snapshots}
                        period={period}
                        setPeriod={setPeriod}
                        change={periodChange}
                        onRefresh={refresh}
                        onTab={changeTab}
                    />
                )}

                {tab === 'tokens' && (
                    <section className="uni-portfolio-tab-page">
                        <div className="uni-portfolio-tab-toolbar">
                            <div>
                                <h1>{formatUsd(totalValue)}</h1>
                                <span>{filteredTokens.length} {filteredTokens.length === 1 ? 'token' : 'tokens'}</span>
                            </div>
                            <label className="uni-portfolio-search-input">
                                <Search aria-hidden="true" />
                                <input
                                    aria-label="Search portfolio tokens"
                                    value={tokenSearch}
                                    onChange={(event) => setTokenSearch(event.target.value)}
                                    placeholder="Search tokens"
                                    autoComplete="off"
                                    spellCheck="false"
                                />
                            </label>
                        </div>

                        {filteredTokens.length > 0 ? (
                            <TokenTable
                                tokens={filteredTokens}
                                totalValue={totalValue}
                                sortKey={sortKey}
                                sortDirection={sortDirection}
                                onSort={changeSort}
                            />
                        ) : (
                            <div className="uni-portfolio-large-empty">
                                <Search aria-hidden="true" />
                                <strong>No matching tokens</strong>
                                <span>Try another token name, symbol, contract, or network.</span>
                            </div>
                        )}

                        {hiddenAssets.length > 0 && (
                            <details className="uni-portfolio-hidden-assets">
                                <summary>Hidden tokens ({hiddenAssets.length})</summary>
                                <p>Unverified or risky assets stay outside the main portfolio value.</p>
                            </details>
                        )}
                    </section>
                )}

                {tab === 'nfts' && (
                    <section className="uni-portfolio-tab-page">
                        <div className="uni-portfolio-tab-toolbar">
                            <div>
                                <h1>NFTs</h1>
                                <span>Collectibles owned by this wallet</span>
                            </div>
                        </div>
                        <div className="uni-portfolio-large-empty">
                            <span className="uni-portfolio-nft-placeholder">◇</span>
                            <strong>NFT indexing is not enabled</strong>
                            <span>PistachioSwap does not currently load NFT inventory, so this view stays empty rather than inventing holdings.</span>
                        </div>
                    </section>
                )}

                {tab === 'activity' && (
                    <section className="uni-portfolio-tab-page">
                        <div className="uni-portfolio-tab-toolbar activity">
                            <div>
                                <h1>Activity</h1>
                                <span>{visibleActivity.length} confirmed transactions</span>
                            </div>
                            <div className="uni-portfolio-activity-filters">
                                <label className="uni-portfolio-search-input">
                                    <Search aria-hidden="true" />
                                    <input
                                        aria-label="Search portfolio activity"
                                        value={activitySearch}
                                        onChange={(event) => setActivitySearch(event.target.value)}
                                        placeholder="Search activity"
                                        autoComplete="off"
                                        spellCheck="false"
                                    />
                                </label>
                                <select
                                    aria-label="Filter activity type"
                                    value={activityType}
                                    onChange={(event) => setActivityType(event.target.value)}
                                >
                                    {ACTIVITY_TYPES.map((type) => (
                                        <option key={type} value={type}>
                                            {type === 'all' ? 'All activity' : activityLabel(type)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {activityError && (
                            <p className="uni-portfolio-inline-notice">{activityError}</p>
                        )}
                        {activityLoading && filteredActivity.length === 0 ? (
                            <div className="uni-portfolio-activity-loading">
                                {Array.from({ length: 5 }).map((_, index) => <span key={index} />)}
                            </div>
                        ) : filteredActivity.length > 0 ? (
                            <div className="uni-portfolio-activity-table">
                                <div className="uni-portfolio-activity-head">
                                    <span>Transaction</span>
                                    <span>Network</span>
                                    <span>Time</span>
                                    <span />
                                </div>
                                {filteredActivity.map((item) => (
                                    <ActivityRow
                                        key={item.id}
                                        item={item}
                                        assets={activeWalletTokens}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="uni-portfolio-large-empty">
                                <Activity aria-hidden="true" />
                                <strong>No activity found</strong>
                                <span>Confirmed wallet transactions will appear here.</span>
                            </div>
                        )}
                    </section>
                )}
            </div>

            <span className="uni-portfolio-sr-only" aria-live="polite">
                {refreshing ? 'Refreshing portfolio' : ''}
                {!ownWallet && externalWallet.loading ? 'Loading external wallet portfolio' : ''}
                {!ownWallet && externalWallet.error ? externalWallet.error : ''}
            </span>
        </section>
    )
}
