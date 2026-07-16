import { useBalance } from 'wagmi'
import { formatEther } from 'viem'

import { BSC_CHAIN_ID } from '../services/balances.js'

export function useNativeBnbBalance({ address, enabled = true } = {}) {
    const active = Boolean(enabled && address)
    const query = useBalance({
        address: active ? address : undefined,
        chainId: BSC_CHAIN_ID,
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
