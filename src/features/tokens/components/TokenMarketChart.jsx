import { useEffect, useRef } from 'react'
import {
    AreaSeries,
    ColorType,
    HistogramSeries,
    LineSeries,
    createChart,
} from 'lightweight-charts'

function cssColor(name, fallback) {
    if (typeof window === 'undefined') return fallback
    const value = window.getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim()
    return value || fallback
}

function alphaColor(value, alpha, fallback) {
    const hex = String(value ?? '').trim()
    const match = /^#([a-fA-F0-9]{6})$/.exec(hex)
    if (!match) return fallback
    const raw = match[1]
    return `rgba(${parseInt(raw.slice(0, 2), 16)}, ${parseInt(raw.slice(2, 4), 16)}, ${parseInt(raw.slice(4, 6), 16)}, ${alpha})`
}

function chartPoints(points, valueKey) {
    const unique = new Map()
    for (const point of points ?? []) {
        const timestamp = Number(point?.timestamp)
        const value = Number(point?.[valueKey])
        if (!Number.isFinite(timestamp) || !Number.isFinite(value)) continue
        unique.set(Math.max(1, Math.floor(timestamp / 1000)), value)
    }
    return [...unique.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([time, value]) => ({ time, value }))
}

export default function TokenMarketChart({
    points = [],
    height = 320,
    compact = false,
    mode = 'price',
    change = null,
}) {
    const rootRef = useRef(null)

    useEffect(() => {
        const root = rootRef.current
        if (!root) return undefined

        const background = cssColor('--color-background', '#111111')
        const text = cssColor('--color-muted', '#8f8f8f')
        const border = cssColor('--color-border', '#2a2a2a')
        const accent = cssColor('--color-accent', '#76a34a')
        const success = cssColor('--color-success', '#22c55e')
        const critical = cssColor('--color-danger', '#ff4d4f')
        const directional = Number(change) < 0 ? critical : success
        const priceColor = compact ? directional : accent

        const chart = createChart(root, {
            width: root.clientWidth || 1,
            height,
            layout: {
                background: { type: ColorType.Solid, color: background },
                textColor: text,
                fontFamily: 'Ubuntu, system-ui, sans-serif',
                fontSize: compact ? 10 : 12,
            },
            grid: {
                vertLines: { visible: !compact, color: border },
                horzLines: { visible: !compact, color: border },
            },
            leftPriceScale: { visible: false },
            rightPriceScale: {
                visible: !compact,
                borderVisible: false,
                scaleMargins: { top: 0.12, bottom: 0.12 },
            },
            timeScale: {
                visible: !compact,
                borderVisible: false,
                timeVisible: true,
                secondsVisible: false,
                fixLeftEdge: true,
                fixRightEdge: true,
            },
            crosshair: {
                vertLine: { visible: !compact },
                horzLine: { visible: !compact },
            },
            handleScroll: !compact,
            handleScale: !compact,
        })

        const data = chartPoints(
            points,
            mode === 'volume' ? 'volumeUsd' : 'priceUsd',
        )
        if (data.length > 0) {
            if (mode === 'volume') {
                const series = chart.addSeries(HistogramSeries, {
                    color: accent,
                    priceFormat: { type: 'volume' },
                    priceLineVisible: false,
                    lastValueVisible: false,
                })
                series.setData(data)
            } else if (compact) {
                const series = chart.addSeries(LineSeries, {
                    color: priceColor,
                    lineWidth: 2,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false,
                })
                series.setData(data)
            } else {
                const series = chart.addSeries(AreaSeries, {
                    lineColor: priceColor,
                    lineWidth: 2,
                    topColor: alphaColor(
                        priceColor,
                        0.28,
                        'rgba(118, 163, 74, 0.28)',
                    ),
                    bottomColor: alphaColor(
                        priceColor,
                        0.02,
                        'rgba(118, 163, 74, 0.02)',
                    ),
                    priceLineVisible: false,
                    lastValueVisible: false,
                })
                series.setData(data)
            }
            chart.timeScale().fitContent()
        }

        const resize = () => {
            chart.applyOptions({
                width: root.clientWidth || 1,
                height,
            })
        }
        const observer = typeof ResizeObserver === 'function'
            ? new ResizeObserver(resize)
            : null
        observer?.observe(root)
        window.addEventListener('resize', resize)

        return () => {
            observer?.disconnect()
            window.removeEventListener('resize', resize)
            chart.remove()
        }
    }, [change, compact, height, mode, points])

    return (
        <div
            ref={rootRef}
            className={compact
                ? 'token-market-chart token-market-chart-compact'
                : 'token-market-chart'}
            style={{ height }}
            aria-label={mode === 'volume' ? 'Token volume chart' : 'Token price chart'}
        />
    )
}
