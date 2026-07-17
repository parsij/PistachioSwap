import {
    arbitrum,
    avalanche,
    base,
    berachain,
    blast,
    bsc,
    celo,
    cronos,
    gnosis,
    linea,
    mainnet,
    mantle,
    metis,
    mode,
    moonbeam,
    opBNB,
    optimism,
    polygon,
    polygonZkEvm,
    scroll,
    sonic,
    taiko,
    unichain,
    worldchain,
    zkSync,
} from 'viem/chains'

export const MEGAFUEL_CHAIN_ID = 56

const definitions = [
    mainnet,
    bsc,
    polygon,
    arbitrum,
    optimism,
    base,
    avalanche,
    celo,
    gnosis,
    linea,
    scroll,
    zkSync,
    mantle,
    sonic,
    berachain,
    unichain,
    worldchain,
    blast,
    mode,
    metis,
    cronos,
    moonbeam,
    taiko,
    opBNB,
    polygonZkEvm,
] as const

const displayNames = new Map<number, string>([
    [137, 'Polygon PoS'],
    [43114, 'Avalanche C-Chain'],
    [100, 'Gnosis Chain'],
    [59144, 'Linea'],
    [34443, 'Mode'],
    [1088, 'Metis Andromeda'],
    [25, 'Cronos'],
    [167000, 'Taiko'],
])

export const CURATED_EVM_CHAINS = Object.freeze(
    definitions.map((chain) => Object.freeze({
        id: chain.id,
        name: displayNames.get(chain.id) ?? chain.name,
        nativeCurrency: Object.freeze({
            ...chain.nativeCurrency,
            symbol: chain.id === 100 ? 'xDAI' : chain.nativeCurrency.symbol,
        }),
        rpcUrls: chain.rpcUrls,
        blockExplorers: chain.blockExplorers,
        capabilities: Object.freeze({
            send: true,
            sameChainSwap: true,
            crossChainSource: true,
            crossChainDestination: true,
            gasless: chain.id === 56,
            megaFuel: chain.id === MEGAFUEL_CHAIN_ID,
        }),
    })),
)

export type CuratedEvmChain = (typeof CURATED_EVM_CHAINS)[number]

export const CURATED_EVM_CHAIN_IDS = Object.freeze(
    CURATED_EVM_CHAINS.map(({ id }) => id),
)

export const CURATED_EVM_CHAIN_ID_SET: ReadonlySet<number> = new Set(
    CURATED_EVM_CHAIN_IDS,
)

export function isCuratedEvmChainId(value: unknown): value is number {
    return Number.isInteger(value) &&
        CURATED_EVM_CHAIN_ID_SET.has(Number(value))
}

export function requireCuratedEvmChain(chainId: unknown) {
    const numericChainId = Number(chainId)
    const chain = CURATED_EVM_CHAINS.find(({ id }) => id === numericChainId)
    if (!chain) throw new Error('Chain is not enabled.')
    return chain
}
