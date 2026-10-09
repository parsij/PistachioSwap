import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useBalance } from '#wallet-runtime'
import { formatEther } from 'viem'

import { BSC_CHAIN_ID } from '../../../services/balances.js'
import {
    getOptimisticWalletBalanceRevision,
    subscribeOptimisticWalletBalances,
} from '../../wallet/services/optimisticBalances.js'

/**
 * Reads the connected account's native balance for an explicit chain through Wagmi.
 * Submitted transaction updates trigger refreshes; pending quote deltas are
 * never added to or subtracted from a balance that may already include them.
 * @param {{address: string|null, chainId: number, enabled?: boolean}} config Balance query.
 * @returns {{value: bigint|null, formatted: string|null, status: string, error: unknown, refetch: Function}} Balance state.
 * @sideEffects Performs an RPC read when enabled; never prompts the wallet.
 */
export function useNativeBalance({
    address,
    chainId,
    enabled = true,
} = {}) {
    const active = Boolean(enabled && address)
    const resolvedChainId = Number.isInteger(Number(chainId))
        ? Number(chainId)
        : BSC_CHAIN_ID
    const query = useBalance({
        address: active ? address : undefined,
        chainId: resolvedChainId,
        query: { enabled: active },
    })
    const optimisticRevision = useSyncExternalStore(
        subscribeOptimisticWalletBalances,
        getOptimisticWalletBalanceRevision,
        getOptimisticWalletBalanceRevision,
    )
    const previousOptimisticRevisionRef = useRef(optimisticRevision)

    useEffect(() => {
        if (previousOptimisticRevisionRef.current === optimisticRevision) return
        previousOptimisticRevisionRef.current = optimisticRevision
        if (active) void query.refetch()
    }, [active, optimisticRevision, query.refetch])

    const value = active && query.data ? query.data.value : null

    const status = !active
        ? 'idle'
        : query.isError || query.status === 'error'
            ? 'error'
            : query.isSuccess || query.status === 'success' || query.data
                ? 'success'
                : 'loading'
    return {
        ...query,
        status,
        value,
        formatted: value === null ? null : formatEther(value),
    }
}

export function useNativeBnbBalance(options = {}) {
    return useNativeBalance({
        chainId: BSC_CHAIN_ID,
        ...options,
    })
}
