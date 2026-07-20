const PORTFOLIO_NETWORK_ENTRIES = [
    [1, 'eth-mainnet'],
    [56, 'bnb-mainnet'],
    [137, 'polygon-mainnet'],
    [42161, 'arb-mainnet'],
    [10, 'opt-mainnet'],
    [8453, 'base-mainnet'],
    [43114, 'avax-mainnet'],
    [42220, 'celo-mainnet'],
    [100, 'gnosis-mainnet'],
    [59144, 'linea-mainnet'],
    [534352, 'scroll-mainnet'],
    [324, 'zksync-mainnet'],
    [5000, 'mantle-mainnet'],
    [146, 'sonic-mainnet'],
    [80094, 'berachain-mainnet'],
    [130, 'unichain-mainnet'],
    [480, 'worldchain-mainnet'],
    [81457, 'blast-mainnet'],
    [1088, 'metis-mainnet'],
    [204, 'opbnb-mainnet'],
] as const

export type AlchemyPortfolioNetwork =
    (typeof PORTFOLIO_NETWORK_ENTRIES)[number][1]

export const ALCHEMY_PORTFOLIO_MAX_NETWORKS_PER_REQUEST = 5 as const

const byChainId = new Map<number, AlchemyPortfolioNetwork>()
const byNetwork = new Map<AlchemyPortfolioNetwork, number>()

for (const [chainId, network] of PORTFOLIO_NETWORK_ENTRIES) {
    if (byChainId.has(chainId)) {
        throw new Error(`Duplicate Alchemy Portfolio chain ID: ${chainId}.`)
    }
    if (byNetwork.has(network)) {
        throw new Error(`Duplicate Alchemy Portfolio network: ${network}.`)
    }
    byChainId.set(chainId, network)
    byNetwork.set(network, chainId)
}

const chainIds = Object.freeze(
    PORTFOLIO_NETWORK_ENTRIES.map(([chainId]) => chainId),
)

export function getAlchemyPortfolioNetwork(chainId: number) {
    return byChainId.get(Number(chainId)) ?? null
}

export function getChainIdForAlchemyPortfolioNetwork(network: string) {
    return byNetwork.get(network as AlchemyPortfolioNetwork) ?? null
}

export function getAlchemyPortfolioChainIds(): readonly number[] {
    return chainIds
}

export function getUnsupportedPortfolioChainIds(chainIdsToCheck: readonly number[]) {
    return [...new Set(chainIdsToCheck.map(Number))]
        .filter((chainId) => !byChainId.has(chainId))
        .sort((left, right) => left - right)
}

export function chunkAlchemyPortfolioNetworks(
    networks: readonly string[],
    maxSize = ALCHEMY_PORTFOLIO_MAX_NETWORKS_PER_REQUEST,
): AlchemyPortfolioNetwork[][] {
    if (
        !Number.isInteger(maxSize) ||
        maxSize < 1 ||
        maxSize > ALCHEMY_PORTFOLIO_MAX_NETWORKS_PER_REQUEST
    ) {
        throw new Error(
            `Alchemy Portfolio network batches must contain between 1 and ${ALCHEMY_PORTFOLIO_MAX_NETWORKS_PER_REQUEST} networks.`,
        )
    }

    const unique: AlchemyPortfolioNetwork[] = []
    const seen = new Set<string>()
    for (const value of networks) {
        if (typeof value !== 'string' || !value.trim()) {
            throw new Error('Alchemy Portfolio networks must be non-empty identifiers.')
        }
        const network = value.trim()
        if (!byNetwork.has(network as AlchemyPortfolioNetwork)) {
            throw new Error(`Unsupported Alchemy Portfolio network: ${network}.`)
        }
        if (!seen.has(network)) {
            seen.add(network)
            unique.push(network as AlchemyPortfolioNetwork)
        }
    }
    if (unique.length === 0) {
        throw new Error('At least one Alchemy Portfolio network is required.')
    }

    const batches: AlchemyPortfolioNetwork[][] = []
    for (let index = 0; index < unique.length; index += maxSize) {
        batches.push(unique.slice(index, index + maxSize))
    }
    return batches
}
