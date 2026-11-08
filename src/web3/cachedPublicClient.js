/**
 * Cache one public client per Wagmi config and chain. The caller creates a new
 * resolver when the config changes; an unavailable client is never cached so a
 * temporarily missing RPC can recover. This does not cache balances or fees.
 */
export function createCachedPublicClientResolver(config, getPublicClient) {
    const clients = new Map()
    return (requestedChainId) => {
        if (!config) return undefined
        const chainId = requestedChainId == null ? null : Number(requestedChainId)
        if (chainId !== null && (!Number.isSafeInteger(chainId) || chainId <= 0)) {
            return undefined
        }
        const key = chainId ?? 'default'
        if (clients.has(key)) return clients.get(key)
        try {
            const client = getPublicClient(config, chainId === null ? undefined : { chainId })
            if (client) clients.set(key, client)
            return client
        } catch {
            return undefined
        }
    }
}
