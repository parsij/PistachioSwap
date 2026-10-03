import {
    Check,
    Copy,
    LineChart,
    Share2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import PistachioWalletController from '../../passkey/components/PistachioWalletController.jsx'
import GasAssistDialogs from '../../gas-assist/components/GasAssistDialogs.jsx'
import CrossChainReviewDialog from '../../cross-chain/components/CrossChainReviewDialog.jsx'
import SameChainReviewDialog from '../../swap/components/SameChainReviewDialog.jsx'
import SwapCard from '../../swap/components/SwapCard.jsx'
import SwapToolbar from '../../swap/components/SwapToolbar.jsx'
import PendingWalletOperation from '../../wallet/components/wallet/PendingWalletOperation.jsx'
import TokenSelectorOverlay from './TokenSelectorOverlay.jsx'
import TokenIcon from './TokenIcon.jsx'
import TokenMarketChart from './TokenMarketChart.jsx'
import { useTokenMarketSnapshot } from '../hooks/useTokenMarketSnapshot.js'
import { marketNumber, marketUsd } from '../services/marketPresentation.js'
import {
    getTokenDisplayName,
    getTokenDisplaySymbol,
} from '../services/tokenDisplay.js'

import './TokenDetailsPage.css'

const PERIODS = ['1H', '1D', '1W', '1M', '1Y', 'ALL']
const CHART_MODES = [
    { id: 'price', label: 'Price' },
    { id: 'volume', label: 'Volume' },
]

const finite = marketNumber
const formatPrice = marketUsd
const formatCompactUsd = (value) => marketUsd(value, true)

function shortAddress(value) {
    const address = String(value ?? '')
    return /^0x[a-fA-F0-9]{40}$/.test(address)
        ? `${address.slice(0, 6)}...${address.slice(-4)}`
        : address
}

function TokenStat({ label, value }) {
    return (
        <div className="token-details-stat" title={label.startsWith("52W") ? "Based on available historical price samples over the last year" : undefined}>
            <span>{label}</span>
            <strong>{formatCompactUsd(value)}</strong>
        </div>
    )
}

export default function TokenDetailsPage({ token, page, onBrowseTokens }) {
    const [period, setPeriod] = useState('1D')
    const [chartMode, setChartMode] = useState('price')
    const { market, stats, loading, error } = useTokenMarketSnapshot(token, period, true, true)
    const [copied, setCopied] = useState(false)
    const [hovered, setHovered] = useState(null)

    useEffect(() => {
        setPeriod('1D')
        setChartMode('price')
        setHovered(null)
    }, [token?.chainId, token?.address])

    const displayPrice =
        (chartMode === 'price' ? hovered?.value : null) ??
        market?.currentPriceUsd ??
        token?.priceUSD ??
        token?.marketPriceUSD ??
        token?.trustedPriceUSD
    const displayChange = market?.periodChangePercent ??
        (period === '1D' ? token?.priceChange24hPercent : null)
    const displayChangeUsd = market?.periodChangeUsd
    const changeNumber = finite(displayChange)
    const changeClass = changeNumber !== null && changeNumber < 0
        ? 'negative'
        : 'positive'
    const name = market?.name ?? getTokenDisplayName(token)
    const symbol = market?.symbol ?? getTokenDisplaySymbol(token)
    const displayedToken = useMemo(() => market?.imageUrl
        ? {
            ...token,
            name,
            symbol,
            logoURI: market.imageUrl,
            iconUrl: market.imageUrl,
            logoCandidates: [
                market.imageUrl,
                ...(token?.logoCandidates ?? []),
            ],
        }
        : token, [market?.imageUrl, name, symbol, token])

    async function copyAddress() {
        const address = String(token?.address ?? '')
        if (token?.isNative || /^0x0{40}$/i.test(address) || !/^0x[a-fA-F0-9]{40}$/.test(address)) return
        try {
            await navigator.clipboard.writeText(address)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
        } catch {
            // Clipboard is optional in private contexts.
        }
    }

    async function shareToken() {
        const payload = {
            title: `${name} (${symbol})`,
            url: window.location.href,
        }
        if (navigator.share) {
            try {
                await navigator.share(payload)
                return
            } catch {
                return
            }
        }
        try {
            await navigator.clipboard.writeText(window.location.href)
        } catch {
            // Sharing is optional when clipboard access is unavailable.
        }
    }

    if (!token) {
        return (
            <section className="token-details-page token-details-loading">
                <div className="token-details-skeleton" />
            </section>
        )
    }

    return (
        <>
            <PendingWalletOperation
                walletAddress={page.operationStatus?.walletAddress ?? null}
            />
            <section className="token-details-page">
                <nav className="token-details-breadcrumb" aria-label="Token breadcrumb">
                    <button type="button" className="token-details-browse" onClick={onBrowseTokens}>Tokens</button>
                    <span aria-hidden="true">›</span>
                    <strong>{symbol}</strong>
                </nav>

                <header className="token-details-header">
                    <div className="token-details-token-identity">
                        <TokenIcon token={displayedToken} size="featured" />
                        <div>
                            <h2>
                                {name}
                                <span>{symbol}</span>
                            </h2>
                            <button
                                type="button"
                                disabled={token?.isNative === true || /^0x0{40}$/i.test(token.address)}
                                className="token-details-address"
                                onClick={copyAddress}
                                aria-label="Copy token address"
                            >
                                <span>{token?.isNative || /^0x0{40}$/i.test(token.address) ? "Native token" : shortAddress(token.address)}</span>
                                {copied
                                    ? <Check aria-hidden="true" />
                                    : <Copy aria-hidden="true" />}
                            </button>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="token-details-share"
                        aria-label="Share token"
                        onClick={shareToken}
                    >
                        <Share2 aria-hidden="true" />
                    </button>
                </header>

                <div className="token-details-divider" />

                <div className="token-details-layout">
                    <main className="token-details-left">
                        <section className="token-details-chart-section">
                            <div className="token-details-price-copy">
                                <strong>{chartMode === 'volume' ? formatCompactUsd(hovered?.value ?? market?.chart?.points?.at(-1)?.volumeUsd) : formatPrice(displayPrice)}</strong>
                                {chartMode === 'volume' && <small className="token-details-chart-caption">Reported 24-hour volume</small>}
                                {chartMode === 'price' && changeNumber !== null && (
                                    <span className={changeClass}>
                                        {changeNumber < 0 ? '▼' : '▲'}{' '}
                                        {displayChangeUsd != null
                                            ? `${formatPrice(Math.abs(displayChangeUsd))} `
                                            : ''}
                                        ({Math.abs(changeNumber).toFixed(2)}%) {period}
                                    </span>
                                )}
                                {chartMode === 'price' && changeNumber === null && <span>Change unavailable · {period === 'ALL' ? 'All time' : period}</span>}
                                {hovered && <time dateTime={new Date(hovered.time * 1000).toISOString()}>{new Date(hovered.time * 1000).toLocaleString()}</time>}
                            </div>

                            <div className={loading
                                ? 'token-details-chart-frame loading'
                                : 'token-details-chart-frame'}
                            >
                                <TokenMarketChart
                                    points={market?.chart?.points ?? []}
                                    height={360}
                                    onHover={setHovered}
                                    mode={chartMode}
                                    change={displayChange}
                                />
                                {loading && <div className="token-details-chart-skeleton" role="status" aria-label="Loading market history" />}
                                {error && (market?.chart?.points?.length ?? 0) === 0 && (
                                    <div className="token-details-chart-error">
                                        Market data could not be refreshed.
                                    </div>
                                )}
                            </div>

                            <div className="token-details-chart-controls">
                                <div className="token-details-chart-style" aria-label="Chart style">
                                    <button type="button" className="active" aria-label="Line chart">
                                        <LineChart aria-hidden="true" />
                                    </button>
                                </div>
                                <div className="token-details-chart-types">
                                    {CHART_MODES.map((option) => (
                                        <button
                                            key={option.id}
                                            type="button"
                                            className={chartMode === option.id ? 'active' : ''}
                                            aria-pressed={chartMode === option.id}
                                            onClick={() => { setHovered(null); setChartMode(option.id) }}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="token-details-periods">
                                    {PERIODS.map((option) => (
                                        <button
                                            key={option}
                                            type="button"
                                            className={period === option ? 'active' : ''}
                                            aria-pressed={period === option}
                                            onClick={() => { setHovered(null); setPeriod(option) }}
                                        >
                                            {option === 'ALL' ? 'All' : option}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </section>

                        <section className="token-details-stats" aria-busy={loading && !stats}>
                            <h3>Stats</h3>
                            <div className="token-details-stats-grid">
                                <TokenStat label={stats?.tvlUsd != null ? "TVL" : token?.liquidityUsd != null ? "Pool liquidity" : "TVL"} value={stats?.tvlUsd ?? token?.liquidityUsd} />
                                <TokenStat label="Market cap" value={stats?.marketCapUsd} />
                                <TokenStat label="FDV" value={stats?.fdvUsd ?? token?.fdvUsd} />
                                <TokenStat label="1 day volume" value={stats?.volume24hUsd ?? token?.volume24hUsd} />
                                <TokenStat label="52W High" value={stats?.high52wUsd} />
                                <TokenStat label="52W Low" value={stats?.low52wUsd} />
                            </div>
                        </section>
                    </main>

                    <aside className="token-details-right">
                        <div className="token-details-swap">
                            <SwapToolbar {...page.toolbar} />
                            <SwapCard {...page.card} />
                        </div>
                    </aside>
                </div>
            </section>

            <TokenSelectorOverlay {...page.tokenSelector} />
            <GasAssistDialogs {...page.gasAssistDialogs} />
            <SameChainReviewDialog {...page.sameChainReview} />
            <CrossChainReviewDialog {...page.crossChainReview} />
            <PistachioWalletController />
        </>
    )
}
