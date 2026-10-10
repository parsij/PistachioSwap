import { getCuratedEvmChain, TOKEN_DISCOVERY_CHAIN_IDS } from '../../../web3/curatedEvmChains.js'

export const SWAP_CHAIN_USAGE_PREFIX = 'pistachio:swap-chain-usage:v1:'
const MAX_RECENT_HASHES = 512
const walletKey = (address) => /^0x[a-f0-9]{40}$/i.test(String(address ?? ''))
    ? SWAP_CHAIN_USAGE_PREFIX + address.toLowerCase() : null
const supported = (chainId) => TOKEN_DISCOVERY_CHAIN_IDS.includes(Number(chainId))

function readUsage(storage, key) {
    let parsed = {}
    try { parsed = JSON.parse(storage?.getItem(key) ?? '{}') } catch { /* Recover corrupt local preferences. */ }
    const counts = {}
    for (const [id, count] of Object.entries(parsed?.counts ?? {})) {
        if (supported(id) && Number.isSafeInteger(count) && count > 0) counts[Number(id)] = count
    }
    const seen = Array.isArray(parsed?.seen) ? parsed.seen
        .filter((id) => /^\d+:0x[a-f0-9]{64}$/.test(id)).slice(-MAX_RECENT_HASHES) : []
    return { counts, seen }
}

/** Per-wallet counters only: never fetch or scan wallet transaction history. */
export function preferredSwapChain(walletAddress, storage) {
    try {
        const key = walletKey(walletAddress)
        if (!key) return 1
        storage ??= globalThis.localStorage
        const { counts } = readUsage(storage, key)
        return Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a] || a - b)[0] ?? 1
    } catch { return 1 }
}

/** Count each successful source-chain swap once across receipt callbacks/reloads. */
export function recordSuccessfulSwap({ walletAddress, chainId, hash }, storage) {
    try {
        const key = walletKey(walletAddress)
        if (!key || !supported(chainId) || !/^0x[a-f0-9]{64}$/i.test(String(hash ?? ''))) return false
        storage ??= globalThis.localStorage
        if (!storage) return false
        const usage = readUsage(storage, key)
        const id = `${Number(chainId)}:${hash.toLowerCase()}`
        if (usage.seen.includes(id)) return false
        const chain = Number(chainId)
        usage.counts[chain] = Math.min(Number.MAX_SAFE_INTEGER, (usage.counts[chain] ?? 0) + 1)
        usage.seen = [...usage.seen, id].slice(-MAX_RECENT_HASHES)
        storage.setItem(key, JSON.stringify(usage))
        return true
    } catch { return false }
}

export function preferredSwapInput(walletAddress, storage) {
    const chain = getCuratedEvmChain(preferredSwapChain(walletAddress, storage))
    return { chainId: chain.id, address: '0x0000000000000000000000000000000000000000',
        isNative: true, name: chain.nativeCurrency.name, symbol: chain.nativeCurrency.symbol,
        decimals: chain.nativeCurrency.decimals }
}
