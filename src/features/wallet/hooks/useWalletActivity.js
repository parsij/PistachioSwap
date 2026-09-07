import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'

import {
    normalizeWalletActivity,
    readWalletActivity,
    subscribeWalletActivity,
} from '../services/walletActivity.js'
import {
    DIRECT_WALLET_HISTORY_CHAIN_IDS,
    fetchWalletHistory,
    readCachedWalletHistory,
} from '../services/walletHistory.js'
import { mergeWalletActivity } from '../services/mergeWalletActivity.js'

function configuredHistoryChainIds() {
    const configured = String(
        import.meta.env.VITE_WALLET_HISTORY_CHAIN_IDS ?? '56',
    )
    const requested = [...new Set(configured
        .split(',')
        .map(value => Number(value.trim()))
        .filter(value => DIRECT_WALLET_HISTORY_CHAIN_IDS.includes(value)))]
    return requested.length > 0 ? requested : [56]
}

// History is fetched by the browser directly from the configured indexers/RPCs.
// The Pistachio VPS is deliberately not part of the wallet-history read path.
export const REMOTE_WALLET_HISTORY_CHAIN_IDS = Object.freeze(
    configuredHistoryChainIds(),
)

// Bootstrap can cover 24 live networks. Keep provider pressure bounded instead
// of starting every indexed-chain scan at once in a newly opened browser.
const REMOTE_HISTORY_BATCH_SIZE = 4

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

function normalizeHistoryItems(results) {
    return results
        .filter(result => result.status === 'fulfilled')
        .flatMap(result => result.value.items)
        .map(normalizeWalletActivity)
        .filter(Boolean)
}

async function fetchHistoryBatches({
    batches,
    walletAddress,
    limit,
    force,
    signal,
}) {
    const results = []
    for (const chainIds of batches) {
        if (signal.aborted) break
        try {
            const value = await fetchWalletHistory({
                walletAddress,
                chainIds,
                limit,
                force,
                signal,
            })
            results.push({ status: 'fulfilled', value })
        } catch (reason) {
            if (signal.aborted) break
            results.push({ status: 'rejected', reason })
        }
    }
    return results
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
    const appliedRevision = useRef(0)
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
        const force = revision !== appliedRevision.current
        setRemoteItems([])
        setLoading(true)
        setError(null)

        const cachedPromise = Promise.allSettled(
            batches.map(chainIds => readCachedWalletHistory({
                walletAddress,
                chainIds,
                limit,
            })),
        ).then(results => {
            if (controller.signal.aborted) return
            const cached = normalizeHistoryItems(results)
            if (cached.length > 0) setRemoteItems(cached)
        })

        cachedPromise.then(() => fetchHistoryBatches({
            batches,
            walletAddress,
            limit,
            force,
            signal: controller.signal,
        })).then(results => {
            if (controller.signal.aborted) return

            const fulfilled = results.filter(result => result.status === 'fulfilled')
            const normalized = normalizeHistoryItems(results)
            if (normalized.length > 0 || fulfilled.length > 0) {
                setRemoteItems(normalized)
            }
            if (fulfilled.length === 0) {
                setError('Wallet history could not be loaded.')
            } else if (
                fulfilled.length < results.length ||
                fulfilled.some(result => result.value.partial)
            ) {
                setError('Some wallet history could not be loaded.')
            }
            appliedRevision.current = revision
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false)
        })

        return () => controller.abort()
    }, [batches, chainId, enabled, limit, revision, walletAddress])

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
