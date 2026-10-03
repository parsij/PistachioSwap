import * as Popover from '@radix-ui/react-popover'
import { Check, Copy, Maximize2 } from 'lucide-react'
import { cloneElement, useEffect, useMemo, useRef, useState } from 'react'
import { createCssVariables } from '../../../swapConfig.js'
import TokenIcon from './TokenIcon.jsx'
import TokenMarketChart from './TokenMarketChart.jsx'
import { useTokenMarketSnapshot } from '../hooks/useTokenMarketSnapshot.js'
import { getTokenDisplaySymbol } from '../services/tokenDisplay.js'
import { marketNumber, marketPercent, marketUsd } from '../services/marketPresentation.js'
import './TokenHoverCard.css'

const HOVER_QUERY = '(hover: hover) and (pointer: fine)'
const PREVIEW_WAIT = 300
const LEAVE_GRACE = 180

function usePreviewPointer() {
    const [available, setAvailable] = useState(() => window.matchMedia?.(HOVER_QUERY).matches ?? false)
    useEffect(() => {
        const query = window.matchMedia?.(HOVER_QUERY)
        if (!query) return undefined
        const update = () => setAvailable(query.matches)
        query.addEventListener('change', update)
        return () => query.removeEventListener('change', update)
    }, [])
    return available
}

/** Independent Pistachio preview: delayed intent, interactive gap grace, read-only data. */
export default function TokenHoverCard({ token, children, onNavigate }) {
    const available = usePreviewPointer()
    const theme = useMemo(() => createCssVariables(), [])
    const [open, setOpen] = useState(false)
    const [requested, setRequested] = useState(false)
    const [copied, setCopied] = useState(false)
    const timer = useRef(null)
    const copyTimer = useRef(null)
    const cardRef = useRef(null)
    const { market, loading, error } = useTokenMarketSnapshot(token, '1D', requested && available)

    function cancelIntent() {
        window.clearTimeout(timer.current)
        timer.current = null
    }
    function enter() {
        cancelIntent()
        if (!available || open) return
        timer.current = window.setTimeout(() => {
            setRequested(true)
            setOpen(true)
        }, PREVIEW_WAIT)
    }
    function leave() {
        cancelIntent()
        timer.current = window.setTimeout(() => setOpen(false), LEAVE_GRACE)
    }
    function close() {
        cancelIntent()
        setOpen(false)
    }
    useEffect(() => () => {
        window.clearTimeout(timer.current)
        window.clearTimeout(copyTimer.current)
    }, [])
    useEffect(() => {
        if (!open) return undefined
        const dismiss = (event) => {
            if (event.type === 'scroll' && cardRef.current?.contains(event.target)) return
            setOpen(false)
        }
        window.addEventListener('scroll', dismiss, true)
        window.addEventListener('resize', dismiss)
        return () => {
            window.removeEventListener('scroll', dismiss, true)
            window.removeEventListener('resize', dismiss)
        }
    }, [open])

    if (!available) return children
    const trigger = cloneElement(children, {
        onPointerEnter: (event) => {
            children.props.onPointerEnter?.(event)
            if (event.pointerType === 'mouse') enter()
        },
        onPointerLeave: (event) => {
            children.props.onPointerLeave?.(event)
            if (event.pointerType === 'mouse') leave()
        },
        onFocus: (event) => {
            children.props.onFocus?.(event)
            if (event.currentTarget.matches(':focus-visible')) enter()
        },
        onBlur: (event) => {
            children.props.onBlur?.(event)
            if (!cardRef.current?.contains(event.relatedTarget)) leave()
        },
        'aria-expanded': open,
    })
    const price = market?.currentPriceUsd ?? token?.priceUSD ?? token?.marketPriceUSD ?? token?.trustedPriceUSD
    const change = market?.change24hPercent ?? token?.priceChange24hPercent
    const hasContract = /^0x[a-fA-F0-9]{40}$/.test(token?.address ?? '') && token?.isNative !== true && !/^0x0{40}$/i.test(token.address)
    const hasData = marketNumber(price) !== null || (market?.chart?.points?.length ?? 0) > 1

    async function copyAddress() {
        try {
            await navigator.clipboard.writeText(token.address)
            setCopied(true)
            window.clearTimeout(copyTimer.current)
            copyTimer.current = window.setTimeout(() => setCopied(false), 1500)
        } catch { setCopied(false) }
    }

    return (
        <Popover.Root open={open} onOpenChange={(value) => value ? setOpen(true) : close()}>
            <Popover.Anchor asChild>{trigger}</Popover.Anchor>
            <Popover.Portal>
                <Popover.Content
                    ref={cardRef}
                    aria-label={`${getTokenDisplaySymbol(token)} market preview`}
                    className="token-hover-card"
                    style={theme}
                    side="right" align="start" sideOffset={8} collisionPadding={16}
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    onCloseAutoFocus={(event) => event.preventDefault()}
                    onPointerEnter={cancelIntent} onPointerLeave={leave}
                    onFocusCapture={cancelIntent}
                    onBlurCapture={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) leave()
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <div className="token-hover-card-header">
                        <div className="token-hover-card-identity">
                            <TokenIcon token={token} size="small" />
                            <span>{getTokenDisplaySymbol(token)}</span>
                        </div>
                        <div className="token-hover-card-actions">
                            {hasContract && <button type="button" aria-label={copied ? 'Address copied' : 'Copy token address'} onClick={copyAddress}>
                                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                            </button>}
                            <button type="button" aria-label="Open token details" onClick={() => { close(); onNavigate(token) }}>
                                <Maximize2 aria-hidden="true" />
                            </button>
                        </div>
                    </div>
                    {loading ? (
                        <div className="token-hover-card-loading" role="status" aria-label="Loading token market data"><span /><span /><span /></div>
                    ) : !hasData ? (
                        <div className="token-hover-card-unavailable" role="status">Market data unavailable</div>
                    ) : (
                        <>
                            <div className="token-hover-card-price">
                                <strong>{marketUsd(price)}</strong>
                                <span className={marketNumber(change) === null ? '' : Number(change) < 0 ? 'negative' : 'positive'}>
                                    {marketPercent(change)} <em>today</em>
                                </span>
                            </div>
                            <TokenMarketChart compact height={104} points={market?.chart?.points ?? []} change={change} />
                            {error && <small className="token-hover-card-notice">History could not be refreshed</small>}
                        </>
                    )}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}
