import { expect, it } from 'vitest'
import { toMarketChartPoints } from './marketChartPoints.js'
import { marketNumber, marketUsd } from '../services/marketPresentation.js'
it('preserves unavailable values and genuine zero separately', () => {
    for (const value of [null, undefined, '', ' ', false, Infinity]) expect(marketNumber(value)).toBeNull()
    expect(marketNumber(0)).toBe(0)
    expect(marketUsd(null)).toBe('—')
})
it('filters missing and unsafe values without manufacturing points, sorts and deduplicates timestamps', () => {
    expect(toMarketChartPoints([
        { timestamp: 2000, priceUsd: 2 }, { timestamp: 1000, priceUsd: null },
        { timestamp: 3000, priceUsd: 3 }, { timestamp: 2000, priceUsd: 4 },
        { timestamp: 4000, priceUsd: Number.MAX_VALUE },
    ])).toEqual([{ time: 2, value: 4 }, { time: 3, value: 3 }])
    expect(toMarketChartPoints([{ timestamp: 2000, priceUsd: 2, volumeUsd: null }], 'volume')).toEqual([])
})
