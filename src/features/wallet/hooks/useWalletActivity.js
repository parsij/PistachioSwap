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

function activityKey(item) {
    return item?.hash
        ? `${Number(item.chainId)}:${String(item.hash).toLowerCase()}:${String(item.type)}`
        : String(item?.id ?? '')
}

export function useWalletActivity({
    walletAddress,
    chainIds = [],
    limit = 50,
} = {}) {
    const [localItems, setLocalItems] = useState(() =>
        readWalletActivity({ walletAddress, limit }))
    const [remoteItems, setRemoteItems] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const chainKey = useMemo(
        () => [...new Set(chainIds.map(Number).filter(Number.isSafeInteger))]
            .sort((left, right) => left - right)
            .join(','),
        [chainIds],
    )

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
        fetchWalletHistory({
            walletAddress,
            chainIds: chainKey ? chainKey.split(',').map(Number) : [],
            limit,
            signal: controller.signal,
        }).then((payload) => {
            const normalized = payload.items
                .map(normalizeWalletActivity)
                .filter(Boolean)
            setRemoteItems(normalized)
        }).catch((caught) => {
            if (caught?.name === 'AbortError') return
            setRemoteItems([])
            setError(caught instanceof Error
                ? caught.message
                : 'Wallet history could not be loaded.')
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false)
        })

        return () => controller.abort()
    }, [chainKey, limit, walletAddress])

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
