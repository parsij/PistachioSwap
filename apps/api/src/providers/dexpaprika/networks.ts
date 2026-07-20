export const DEXPAPRIKA_NETWORK_BY_CHAIN_ID: Readonly<Record<number, string>> = Object.freeze({
    1: 'ethereum',
    10: 'optimism',
    25: 'cronos',
    56: 'bsc',
    130: 'unichain',
    137: 'polygon',
    146: 'sonic',
    324: 'zksync',
    5000: 'mantle',
    8453: 'base',
    42161: 'arbitrum',
    42220: 'celo',
    43114: 'avalanche',
    59144: 'linea',
    80094: 'berachain',
    81457: 'blast',
    534352: 'scroll',
})

export function getDexPaprikaNetworkId(chainId: number) {
    return DEXPAPRIKA_NETWORK_BY_CHAIN_ID[chainId] ?? null
}
