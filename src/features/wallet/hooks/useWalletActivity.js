import {
    useCallback,
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
import { mergeWalletActivity } from '../services/mergeWalletActivity.js'

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

export function useWalletActivity({
    walletAddress,
    chainId,
    enabled = true,
    limit = 50,
} = {}) {
    const [localItems, setLocalItems] = useState(() =>
        readWalletActivity({ walletAddress, limit }))
    const [remoteItems, setRemoteItems] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [revision, setRevision] = useState(0)
    const refetch = useCallback(() => setRevision(value => value + 1), [])
    const batches = useMemo(historyBatches, [])

    useEffect(() => {
        const refreshLocal = () => setLocalItems(
            readWalletActivity({ walletAddress, limit }),
        )
        refreshLocal()
        return subscribeWalletActivity(() => {
            refreshLocal()
            setRevision(value => value + 1)
        })
    }, [limit, walletAddress])

    useEffect(() => {
        if (!enabled || !/^0x[a-fA-F0-9]{40}$/.test(String(walletAddress ?? ''))) {
            setRemoteItems([])
            setLoading(false)
            setError(null)
            return undefined
        }

        const controller = new AbortController()
        setRemoteItems([])
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
            } else if (fulfilled.length < results.length || fulfilled.some(result => result.value.partial)) {
                setError('Some wallet history could not be loaded.')
            }
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false)
        })

        return () => controller.abort()
    }, [batches, chainId, enabled, limit, walletAddress, revision])

    const items = useMemo(() => {
        return mergeWalletActivity(localItems, remoteItems, limit)
            .filter(item => item.walletAddress.toLowerCase() === String(walletAddress).toLowerCase())
    }, [limit, localItems, remoteItems, walletAddress])

    return {
        items,
        loading,
        error,
        refetch,
    }
}
