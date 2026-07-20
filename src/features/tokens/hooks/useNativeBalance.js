import { useBalance } from 'wagmi'
import { formatEther } from 'viem'

import { BSC_CHAIN_ID } from '../../../services/balances.js'

/**
 * Reads the connected account's native balance for an explicit chain through Wagmi.
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
    const query = useBalance({
        address: active ? address : undefined,
        chainId: Number.isInteger(Number(chainId))
            ? Number(chainId)
            : BSC_CHAIN_ID,
        query: { enabled: active },
    })

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
