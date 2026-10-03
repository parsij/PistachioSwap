import { marketNumber } from '../services/marketPresentation.js'

export function toMarketChartPoints(points, mode = 'price') {
    const unique = new Map()
    for (const point of points ?? []) {
        const timestamp = marketNumber(point?.timestamp)
        const value = marketNumber(point?.[mode === 'volume' ? 'volumeUsd' : 'priceUsd'])
        if (timestamp === null || timestamp <= 0 || value === null || value < 0 || value > Number.MAX_SAFE_INTEGER / 100) continue
        const time = Math.floor(timestamp / 1000)
        if (time > 0) unique.set(time, { time, value })
    }
    return [...unique.values()].sort((left, right) => left.time - right.time)
}

