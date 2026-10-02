// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
    portfolioSnapshotChange,
    readPortfolioSnapshots,
    recordPortfolioSnapshot,
} from './portfolioHistory.js'

const ADDRESS = '0x1111111111111111111111111111111111111111'

beforeEach(() => {
    window.localStorage.clear()
})

describe('portfolioHistory', () => {
    it('stores only real local snapshots and filters them by period', () => {
        const hour = 60 * 60 * 1000
        const now = 10 * hour

        recordPortfolioSnapshot({
            walletAddress: ADDRESS,
            valueUSD: 10,
            now: now - 2 * hour,
        })
        recordPortfolioSnapshot({
            walletAddress: ADDRESS,
            valueUSD: 12,
            now,
        })

        expect(readPortfolioSnapshots({
            walletAddress: ADDRESS,
            period: '1H',
            now,
        })).toEqual([{ time: now, value: 12 }])
        expect(readPortfolioSnapshots({
            walletAddress: ADDRESS,
            period: '1D',
            now,
        })).toHaveLength(2)
    })

    it('computes change only when at least two snapshots exist', () => {
        expect(portfolioSnapshotChange([{ time: 1, value: 10 }])).toBeNull()
        expect(portfolioSnapshotChange([
            { time: 1, value: 10 },
            { time: 2, value: 12 },
        ])).toEqual({
            absolute: 2,
            percent: 20,
        })
    })
})
