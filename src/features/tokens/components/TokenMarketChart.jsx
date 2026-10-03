import { useEffect, useMemo, useRef } from 'react'
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, createChart } from 'lightweight-charts'
import { marketUsd } from '../services/marketPresentation.js'

import { toMarketCandles, toMarketChartPoints } from '../model/marketChartPoints.js'

function themeColor(root, name, fallback) {
    return getComputedStyle(root).getPropertyValue(name).trim() || fallback
}

export default function TokenMarketChart({ points = [], candles = [], chartStyle = 'line', height = 320, compact = false, mode = 'price', change = null, onHover }) {
    const rootRef = useRef(null)
    const instance = useRef(null)
    const hoverRef = useRef(onHover)
    useEffect(() => { hoverRef.current = onHover }, [onHover])
    const isCandles = mode === 'price' && chartStyle === 'candles'
    const data = useMemo(() => isCandles ? toMarketCandles(candles) : toMarketChartPoints(points, mode), [mode, points, candles, isCandles])

    useEffect(() => {
        const root = rootRef.current
        if (!root) return undefined
        const muted = themeColor(root, '--color-muted', '#8f8f8f')
        const border = themeColor(root, '--color-border', '#2a2a2a')
        const chart = createChart(root, {
            autoSize: true,
            height,
            layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: muted,
                fontFamily: getComputedStyle(root).fontFamily, fontSize: 12, attributionLogo: false },
            localization: { priceFormatter: (value) => marketUsd(value, mode === 'volume') },
            grid: { vertLines: { visible: false }, horzLines: { visible: false } },
            leftPriceScale: { visible: false },
            rightPriceScale: { visible: !compact && root.clientWidth > 480, borderVisible: false,
                scaleMargins: { top: compact ? 0.15 : 0.27, bottom: 0.12 } },
            timeScale: { visible: !compact, borderVisible: false, timeVisible: true, secondsVisible: false,
                fixLeftEdge: true, fixRightEdge: true },
            crosshair: { mode: compact ? CrosshairMode.Hidden : CrosshairMode.Magnet,
                vertLine: { color: border, labelVisible: false }, horzLine: { visible: false, labelVisible: false } },
            handleScroll: compact ? false : { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
            handleScale: compact ? false : { mouseWheel: false, pinch: true, axisPressedMouseMove: false },
        })
        const series = chart.addSeries(isCandles ? CandlestickSeries : mode === 'volume' ? HistogramSeries : LineSeries, {
            color: themeColor(root, '--color-accent', '#76a34a'), lineWidth: 2,
            upColor: themeColor(root, '--color-success', '#22c55e'), downColor: themeColor(root, '--color-danger', '#ff4d4f'), borderVisible: false,
            wickUpColor: themeColor(root, '--color-success', '#22c55e'), wickDownColor: themeColor(root, '--color-danger', '#ff4d4f'),
            priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: !compact,
        })
        instance.current = { chart, series }
        const hover = (event) => {
            const value = event.seriesData.get(series)
            hoverRef.current?.(event.point && value ? { time: value.time, value: value.value ?? value.close } : null)
        }
        chart.subscribeCrosshairMove(hover)
        const observer = new ResizeObserver(() => {
            chart.applyOptions({ rightPriceScale: { visible: !compact && root.clientWidth > 480 } })
        })
        observer.observe(root)
        return () => {
            observer.disconnect()
            chart.unsubscribeCrosshairMove(hover)
            chart.remove()
            instance.current = null
        }
    }, [compact, height, mode, isCandles])

    useEffect(() => {
        const current = instance.current
        if (!current) return
        const color = compact ? themeColor(rootRef.current, Number(change) < 0 ? '--color-danger' : '--color-success', Number(change) < 0 ? '#ff4d4f' : '#22c55e')
            : themeColor(rootRef.current, '--color-accent', '#76a34a')
        current.series.applyOptions({ color })
        current.series.setData(data)
        current.chart.timeScale().fitContent()
        hoverRef.current?.(null)
    }, [change, compact, data, height, mode, isCandles])

    return (
        <div className={`token-chart-container${compact ? ' compact' : ''}`} style={{ height }}>
            <div ref={rootRef} className="token-market-chart" style={{ height }} aria-label={isCandles ? 'Token candlestick chart' : mode === 'volume' ? 'Token volume chart' : mode === 'tvl' ? 'Token TVL chart' : 'Token price chart'} />
            {data.length < 2 && <div className="token-chart-no-data" role="status">{isCandles ? 'Candlestick history unavailable' : mode === 'volume' ? 'Volume history unavailable' : mode === 'tvl' ? 'TVL history unavailable' : 'Price history unavailable'}</div>}
        </div>
    )
}
