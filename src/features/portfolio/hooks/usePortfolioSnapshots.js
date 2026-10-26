import { useSyncExternalStore } from 'react'
import { portfolioHistorySnapshot, subscribePortfolioHistory, readPortfolioSnapshots } from '../services/portfolioHistory.js'
const serverSnapshot = () => '{}'
export function usePortfolioSnapshots(options) {
    const snapshot = useSyncExternalStore(subscribePortfolioHistory, portfolioHistorySnapshot, serverSnapshot)
    return readPortfolioSnapshots({ ...options, snapshot })
}
