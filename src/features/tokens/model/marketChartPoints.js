import { marketNumber } from '../services/marketPresentation.js'

export function toMarketChartPoints(points, mode = 'price') {
    const unique = new Map()
    for (const point of points ?? []) {
        const timestamp = marketNumber(point?.timestamp)
        const value = marketNumber(point?.[mode === 'volume' ? 'volumeUsd' : mode === 'tvl' ? 'tvlUsd' : 'priceUsd'])
        if (timestamp === null || timestamp <= 0 || value === null || value < 0 || value > Number.MAX_SAFE_INTEGER / 100) continue
        const time = Math.floor(timestamp / 1000)
        if (time > 0) unique.set(time, { time, value })
    }
    return [...unique.values()].sort((left, right) => left.time - right.time)
}

export function toMarketCandles(candles) {
    const unique = new Map()
    for (const point of candles ?? []) {
        const timestamp = marketNumber(point?.timestamp)
        const values = ['open', 'high', 'low', 'close'].map((key) => marketNumber(point?.[key]))
        if (timestamp === null || timestamp < 1000 || values.some((value) => value === null || value < 0 || value > Number.MAX_SAFE_INTEGER / 100)) continue
        const [open, high, low, close] = values
        if (high < Math.max(open, close) || low > Math.min(open, close)) continue
        const time = Math.floor(timestamp / 1000)
        unique.set(time, { time, open, high, low, close })
    }
    return [...unique.values()].sort((a, b) => a.time - b.time)
}
