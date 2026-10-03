import {
    Check,
    Copy,
    LineChart,
    Share2,
    CandlestickChart,
    Ellipsis,
    ExternalLink,
} from 'lucide-react'
import * as Popover from '@radix-ui/react-popover'
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
import MarketActionTooltip from './MarketActionTooltip.jsx'
import { getCuratedEvmChain } from '../../../web3/curatedEvmChains.js'
import { createCssVariables } from '../../../swapConfig.js'
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
    { id: 'tvl', label: 'TVL' },
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
    const [chartStyle, setChartStyle] = useState('line')
    const { market, stats, loading, error } = useTokenMarketSnapshot(token, period, true, true, chartMode === 'price' ? chartStyle : 'line')
    const [copied, setCopied] = useState(false)
    const copyTimer = useRef(null)
    const theme = useMemo(() => createCssVariables(), [])
    const chain = getCuratedEvmChain(token?.chainId)
    const [hovered, setHovered] = useState(null)
    useEffect(() => () => window.clearTimeout(copyTimer.current), [])

    useEffect(() => {
        setPeriod('1D')
        setChartMode('price')
        setChartStyle('line')
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
            window.clearTimeout(copyTimer.current)
            copyTimer.current = window.setTimeout(() => setCopied(false), 1200)
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
                            <MarketActionTooltip label={copied ? 'Address copied' : 'Copy token address'}><button
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
                            </button></MarketActionTooltip>
                        </div>
                    </div>
                    <div className="token-details-header-actions"><MarketActionTooltip label="Share token"><button
                        type="button"
                        className="token-details-share"
                        aria-label="Share token"
                        onClick={shareToken}
                    >
                        <Share2 aria-hidden="true" />
                    </button></MarketActionTooltip>
                    <Popover.Root><Popover.Trigger asChild><button type="button" className="token-details-share" aria-label="More token options"><Ellipsis aria-hidden="true" /></button></Popover.Trigger>
                        <Popover.Portal><Popover.Content className="token-details-links" style={theme} sideOffset={8} collisionPadding={12} aria-label="Token links">
                            {chain?.blockExplorers?.default?.url && <a href={`${chain.blockExplorers.default.url}${token.isNative || /^0x0{40}$/i.test(token.address) ? '' : `/token/${token.address}`}`} target="_blank" rel="noopener noreferrer">View on explorer <ExternalLink size={16} /></a>}
                            {market?.coinGeckoUrl && <a href={market.coinGeckoUrl} target="_blank" rel="noopener noreferrer">View on CoinGecko <ExternalLink size={16} /></a>}
                            {market?.websites?.slice(0, 1).map((url) => <a key={url} href={url} target="_blank" rel="noopener noreferrer">Official website <ExternalLink size={16} /></a>)}
                        </Popover.Content></Popover.Portal>
                    </Popover.Root></div>
                </header>

                <div className="token-details-divider" />

                <div className="token-details-layout">
                    <main className="token-details-left">
                        <section className="token-details-chart-section">
                            <div className="token-details-price-copy">
                                <strong>{chartMode === 'tvl' ? formatCompactUsd(stats?.tvlUsd) : chartMode === 'volume' ? formatCompactUsd(hovered?.value ?? market?.chart?.points?.at(-1)?.volumeUsd) : formatPrice(displayPrice)}</strong>
                                {chartMode === 'volume' && <small className="token-details-chart-caption">Reported 24-hour volume</small>}
                                {chartMode === 'tvl' && <small className="token-details-chart-caption">Total value locked</small>}
                                {period === 'ALL' && market?.chart?.historyLimitDays && <small className="token-details-chart-caption">Available history · up to {market.chart.historyLimitDays} days</small>}
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
                                    candles={market?.chart?.candles ?? []}
                                    chartStyle={chartStyle}
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
                                    <MarketActionTooltip label="Line chart"><button type="button" className={chartStyle === 'line' ? 'active' : ''} aria-label="Line chart" aria-pressed={chartStyle === 'line'} onClick={() => { setHovered(null); setChartStyle('line') }} disabled={chartMode !== 'price'}>
                                        <LineChart aria-hidden="true" />
                                    </button></MarketActionTooltip>
                                    <MarketActionTooltip label="Candlestick chart"><button type="button" className={chartStyle === 'candles' ? 'active' : ''} aria-label="Candlestick chart" aria-pressed={chartStyle === 'candles'} onClick={() => { setHovered(null); setChartStyle('candles') }} disabled={chartMode !== 'price'}><CandlestickChart aria-hidden="true" /></button></MarketActionTooltip>
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
                        <section className="token-details-about"><h3>About {name}</h3><p>{market?.about || 'Token description unavailable.'}</p>
                            <span>{getCuratedEvmChain(token.chainId)?.name} · {symbol}</span>
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
