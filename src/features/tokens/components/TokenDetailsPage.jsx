import {
    Check,
    Copy,
    LineChart,
    Share2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

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
import { fetchTokenMarketDetails } from '../services/tokenDetails.js'
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

function finite(value) {
    const result = Number(value)
    return Number.isFinite(result) ? result : null
}

function formatPrice(value) {
    const number = finite(value)
    if (number === null) return '—'
    if (Math.abs(number) >= 1) {
        return number.toLocaleString(undefined, {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 2,
        })
    }
    return '$' + number.toLocaleString(undefined, {
        maximumSignificantDigits: 6,
    })
}

function formatCompactUsd(value) {
    const number = finite(value)
    if (number === null) return '—'
    return number.toLocaleString(undefined, {
        style: 'currency',
        currency: 'USD',
        notation: Math.abs(number) >= 10_000 ? 'compact' : 'standard',
        maximumFractionDigits: Math.abs(number) >= 10_000 ? 1 : 2,
    })
}

function shortAddress(value) {
    const address = String(value ?? '')
    return /^0x[a-fA-F0-9]{40}$/.test(address)
        ? `${address.slice(0, 6)}...${address.slice(-4)}`
        : address
}

function TokenStat({ label, value }) {
    return (
        <div className="token-details-stat">
            <span>{label}</span>
            <strong>{formatCompactUsd(value)}</strong>
        </div>
    )
}

export default function TokenDetailsPage({ token, page }) {
    const [period, setPeriod] = useState('1D')
    const [chartMode, setChartMode] = useState('price')
    const [market, setMarket] = useState(null)
    const [stats, setStats] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [copied, setCopied] = useState(false)
    const yearStatsLoaded = useRef(false)

    useEffect(() => {
        if (!token) {
            setMarket(null)
            setStats(null)
            setError(null)
            return undefined
        }

        const controller = new AbortController()
        setLoading(true)
        setError(null)
        fetchTokenMarketDetails(token, {
            period,
            includeYearStats: !yearStatsLoaded.current,
            signal: controller.signal,
        }).then((payload) => {
            if (controller.signal.aborted) return
            setMarket(payload)
            if (payload.stats) {
                setStats((current) => ({
                    tvlUsd:
                        payload.stats.tvlUsd ??
                        current?.tvlUsd ??
                        null,
                    marketCapUsd:
                        payload.stats.marketCapUsd ??
                        current?.marketCapUsd ??
                        null,
                    fdvUsd:
                        payload.stats.fdvUsd ??
                        current?.fdvUsd ??
                        null,
                    volume24hUsd:
                        payload.stats.volume24hUsd ??
                        current?.volume24hUsd ??
                        null,
                    high52wUsd:
                        payload.stats.high52wUsd ??
                        current?.high52wUsd ??
                        null,
                    low52wUsd:
                        payload.stats.low52wUsd ??
                        current?.low52wUsd ??
                        null,
                }))
                if (
                    payload.stats.high52wUsd != null ||
                    payload.stats.low52wUsd != null
                ) {
                    yearStatsLoaded.current = true
                }
            }
        }).catch((marketError) => {
            if (!controller.signal.aborted) {
                setError(
                    marketError instanceof Error
                        ? marketError.message
                        : 'Token market data is unavailable.',
                )
            }
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false)
        })

        return () => controller.abort()
    }, [period, token])

    useEffect(() => {
        setPeriod('1D')
        setChartMode('price')
        setMarket(null)
        setStats(null)
        setError(null)
        yearStatsLoaded.current = false
    }, [token?.chainId, token?.address])

    const displayPrice =
        market?.currentPriceUsd ??
        token?.priceUSD ??
        token?.marketPriceUSD ??
        token?.trustedPriceUSD
    const displayChange =
        market?.periodChangePercent ??
        token?.priceChange24hPercent
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
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return
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
                    <span>Tokens</span>
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
                                className="token-details-address"
                                onClick={copyAddress}
                                aria-label="Copy token address"
                            >
                                <span>{shortAddress(token.address)}</span>
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
                                <strong>{formatPrice(displayPrice)}</strong>
                                {changeNumber !== null && (
                                    <span className={changeClass}>
                                        {changeNumber > 0 ? '▲' : '▼'}{' '}
                                        {displayChangeUsd != null
                                            ? `${formatPrice(Math.abs(displayChangeUsd))} `
                                            : ''}
                                        ({Math.abs(changeNumber).toFixed(2)}%) {period}
                                    </span>
                                )}
                            </div>

                            <div className={loading
                                ? 'token-details-chart-frame loading'
                                : 'token-details-chart-frame'}
                            >
                                <TokenMarketChart
                                    points={market?.chart?.points ?? []}
                                    height={360}
                                    mode={chartMode}
                                    change={displayChange}
                                />
                                {error && (market?.chart?.points?.length ?? 0) === 0 && (
                                    <div className="token-details-chart-error">
                                        {error}
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
                                            onClick={() => setChartMode(option.id)}
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
                                            onClick={() => setPeriod(option)}
                                        >
                                            {option === 'ALL' ? 'All' : option}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </section>

                        <section className="token-details-stats">
                            <h3>Stats</h3>
                            <div className="token-details-stats-grid">
                                <TokenStat label="TVL" value={stats?.tvlUsd} />
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
