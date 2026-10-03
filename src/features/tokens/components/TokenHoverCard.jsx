import * as Popover from '@radix-ui/react-popover'
import { Copy, Maximize2 } from 'lucide-react'
import { cloneElement, useEffect, useRef, useState } from 'react'

import TokenIcon from './TokenIcon.jsx'
import TokenMarketChart from './TokenMarketChart.jsx'
import { fetchTokenMarketDetails } from '../services/tokenDetails.js'
import {
    getTokenDisplaySymbol,
} from '../services/tokenDisplay.js'

import './TokenHoverCard.css'

const OPEN_DELAY_MS = 300
const CLOSE_DELAY_MS = 100

function canHover() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false
    }
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

function formatPrice(value) {
    const number = Number(value)
    if (!Number.isFinite(number)) return '—'
    if (number >= 1) {
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

function formatChange(value) {
    const number = Number(value)
    if (!Number.isFinite(number)) return '—'
    const prefix = number > 0 ? '+' : ''
    return `${prefix}${number.toFixed(2)}%`
}

/**
 * Search-result hover card adapted from the uploaded Uniswap
 * TokenHoverCard/HoverCard source: 300 ms deferred open, no touch rendering,
 * right-start placement, 8 px offset, and data fetching only after hover intent.
 */
export default function TokenHoverCard({
    token,
    children,
    onNavigate,
}) {
    const [open, setOpen] = useState(false)
    const [hasOpenIntent, setHasOpenIntent] = useState(false)
    const [market, setMarket] = useState(null)
    const [loading, setLoading] = useState(false)
    const [copied, setCopied] = useState(false)
    const openTimer = useRef(null)
    const closeTimer = useRef(null)

    const clearTimers = () => {
        window.clearTimeout(openTimer.current)
        window.clearTimeout(closeTimer.current)
        openTimer.current = null
        closeTimer.current = null
    }

    const scheduleOpen = () => {
        if (!canHover()) return
        window.clearTimeout(closeTimer.current)
        if (open || openTimer.current) return
        openTimer.current = window.setTimeout(() => {
            openTimer.current = null
            setHasOpenIntent(true)
            setOpen(true)
        }, OPEN_DELAY_MS)
    }

    const scheduleClose = () => {
        window.clearTimeout(openTimer.current)
        openTimer.current = null
        window.clearTimeout(closeTimer.current)
        closeTimer.current = window.setTimeout(() => {
            closeTimer.current = null
            setOpen(false)
        }, CLOSE_DELAY_MS)
    }

    useEffect(() => () => clearTimers(), [])

    useEffect(() => {
        if (!hasOpenIntent || market || loading) return undefined
        const controller = new AbortController()
        setLoading(true)
        fetchTokenMarketDetails(token, {
            period: '1D',
            signal: controller.signal,
        }).then((payload) => {
            if (!controller.signal.aborted) setMarket(payload)
        }).catch(() => {
            if (!controller.signal.aborted) setMarket({ unavailable: true })
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false)
        })
        return () => controller.abort()
    }, [hasOpenIntent, loading, market, token])

    const trigger = cloneElement(children, {
        onPointerEnter: (event) => {
            children.props.onPointerEnter?.(event)
            if (event.pointerType === 'mouse') scheduleOpen()
        },
        onPointerLeave: (event) => {
            children.props.onPointerLeave?.(event)
            if (event.pointerType === 'mouse') scheduleClose()
        },
        onFocus: (event) => {
            children.props.onFocus?.(event)
            if (event.currentTarget.matches?.(':focus-visible')) scheduleOpen()
        },
        onBlur: (event) => {
            children.props.onBlur?.(event)
            scheduleClose()
        },
    })

    async function copyAddress(event) {
        event.preventDefault()
        event.stopPropagation()
        const address = String(token?.address ?? '')
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return
        try {
            await navigator.clipboard.writeText(address)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
        } catch {
            // Clipboard can be unavailable in private contexts.
        }
    }

    function expand(event) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        onNavigate(token)
    }

    if (!canHover()) return children

    const change = market?.change24hPercent
    const changeClass = Number(change) < 0 ? 'negative' : 'positive'

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Anchor asChild>{trigger}</Popover.Anchor>
            <Popover.Portal>
                <Popover.Content
                    className="token-hover-card"
                    side="right"
                    align="start"
                    sideOffset={8}
                    collisionPadding={16}
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    onPointerEnter={() => {
                        window.clearTimeout(closeTimer.current)
                        closeTimer.current = null
                    }}
                    onPointerLeave={scheduleClose}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <div className="token-hover-card-header">
                        <div className="token-hover-card-identity">
                            <TokenIcon token={token} size="small" />
                            <span>{getTokenDisplaySymbol(token)}</span>
                        </div>
                        <div className="token-hover-card-actions">
                            <button
                                type="button"
                                aria-label={copied ? 'Address copied' : 'Copy token address'}
                                onClick={copyAddress}
                            >
                                <Copy aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                aria-label="Open token details"
                                onClick={expand}
                            >
                                <Maximize2 aria-hidden="true" />
                            </button>
                        </div>
                    </div>

                    {loading ? (
                        <div className="token-hover-card-loading" aria-label="Loading token market data">
                            <span />
                            <span />
                            <span />
                        </div>
                    ) : market?.unavailable ? (
                        <div className="token-hover-card-unavailable">
                            Token data unavailable
                        </div>
                    ) : (
                        <>
                            <div className="token-hover-card-price">
                                <strong>{formatPrice(market?.currentPriceUsd)}</strong>
                                <span className={changeClass}>
                                    {formatChange(change)} <em>today</em>
                                </span>
                            </div>
                            <TokenMarketChart
                                compact
                                height={104}
                                points={market?.chart?.points ?? []}
                                change={change}
                            />
                        </>
                    )}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}
