import {
    useEffect,
    useMemo,
    useState,
} from 'react'

import {
    normalizeWalletActivity,
    readWalletActivity,
    subscribeWalletActivity,
} from '../services/walletActivity.js'
import { fetchWalletHistory } from '../services/walletHistory.js'

// The backend currently has verified Moralis history support for these active
// networks. Query them all instead of inferring history scope from current
// balances: a chain must not disappear from activity just because the wallet
// no longer holds a token there.
export const REMOTE_WALLET_HISTORY_CHAIN_IDS = Object.freeze([
    1,
    10,
    56,
    100,
    137,
    8453,
    42161,
    43114,
    59144,
])

const REMOTE_HISTORY_BATCH_SIZE = 8

function historyBatches() {
    const batches = []
    for (
        let index = 0;
        index < REMOTE_WALLET_HISTORY_CHAIN_IDS.length;
        index += REMOTE_HISTORY_BATCH_SIZE
    ) {
        batches.push(
            REMOTE_WALLET_HISTORY_CHAIN_IDS.slice(
                index,
                index + REMOTE_HISTORY_BATCH_SIZE,
            ),
        )
    }
    return batches
}

function activityKey(item) {
    return item?.hash
        ? `${Number(item.chainId)}:${String(item.hash).toLowerCase()}:${String(item.type)}`
        : String(item?.id ?? '')
}

export function useWalletActivity({
    walletAddress,
    limit = 50,
} = {}) {
    const [localItems, setLocalItems] = useState(() =>
        readWalletActivity({ walletAddress, limit }))
    const [remoteItems, setRemoteItems] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const batches = useMemo(historyBatches, [])

    useEffect(() => {
        const refreshLocal = () => setLocalItems(
            readWalletActivity({ walletAddress, limit }),
        )
        refreshLocal()
        return subscribeWalletActivity(refreshLocal)
    }, [limit, walletAddress])

    useEffect(() => {
        if (!/^0x[a-fA-F0-9]{40}$/.test(String(walletAddress ?? ''))) {
            setRemoteItems([])
            setLoading(false)
            setError(null)
            return undefined
        }

        const controller = new AbortController()
        setLoading(true)
        setError(null)

        Promise.allSettled(
            batches.map((chainIds) => fetchWalletHistory({
                walletAddress,
                chainIds,
                limit,
                signal: controller.signal,
            })),
        ).then((results) => {
            if (controller.signal.aborted) return

            const fulfilled = results.filter((result) =>
                result.status === 'fulfilled')
            const normalized = fulfilled
                .flatMap((result) => result.value.items)
                .map(normalizeWalletActivity)
                .filter(Boolean)

            setRemoteItems(normalized)
            if (fulfilled.length === 0) {
                setError('Wallet history could not be loaded.')
            } else if (fulfilled.length < results.length) {
                setError('Some wallet history could not be loaded.')
            }
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false)
        })

        return () => controller.abort()
    }, [batches, limit, walletAddress])

    const items = useMemo(() => {
        const merged = new Map()
        for (const item of [...localItems, ...remoteItems]) {
            const key = activityKey(item)
            if (!key) continue
            const existing = merged.get(key)
            merged.set(key, existing ? {
                ...existing,
                ...item,
                token: item.token ?? existing.token ?? null,
                sellToken: item.sellToken ?? existing.sellToken ?? null,
                buyToken: item.buyToken ?? existing.buyToken ?? null,
                amount: item.amount ?? existing.amount ?? null,
                sellAmount: item.sellAmount ?? existing.sellAmount ?? null,
                buyAmount: item.buyAmount ?? existing.buyAmount ?? null,
                recipient: item.recipient ?? existing.recipient ?? null,
            } : item)
        }
        return [...merged.values()]
            .sort((left, right) =>
                Date.parse(right.timestamp) - Date.parse(left.timestamp))
            .slice(0, limit)
    }, [limit, localItems, remoteItems])

    return {
        items,
        loading,
        error,
    }
}
