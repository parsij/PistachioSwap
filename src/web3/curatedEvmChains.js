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

export const DEFAULT_CHAIN_ID = 56
export const MEGAFUEL_CHAIN_ID = 56

const CHAIN_ICON_SLUGS = Object.freeze({
    1: 'ethereum',
    56: 'bsc',
    137: 'polygon',
    42161: 'arbitrum',
    10: 'optimism',
    8453: 'base',
    43114: 'avalanche',
    42220: 'celo',
    100: 'gnosis',
    59144: 'linea',
    534352: 'scroll',
    324: 'zksync-era',
    5000: 'mantle',
    146: 'sonic',
    80094: 'berachain',
    130: 'unichain',
    480: 'world-chain',
    81457: 'blast',
    34443: 'mode',
    1088: 'metis',
    25: 'cronos',
    1284: 'moonbeam',
    167000: 'taiko',
    204: 'opbnb',
    1101: 'polygon-zkevm',
})

export const CURATED_EVM_CHAINS = Object.freeze([
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
])

export const DISABLED_TOKEN_DISCOVERY_CHAIN_IDS = Object.freeze([
    polygonZkEvm.id,
])

const disabledTokenDiscoveryChainIds = new Set(
    DISABLED_TOKEN_DISCOVERY_CHAIN_IDS,
)

export const TOKEN_DISCOVERY_CHAINS = Object.freeze(
    CURATED_EVM_CHAINS.filter(
        ({ id }) => !disabledTokenDiscoveryChainIds.has(id),
    ),
)

export const TOKEN_DISCOVERY_CHAIN_IDS = Object.freeze(
    TOKEN_DISCOVERY_CHAINS.map(({ id }) => id),
)

export const CURATED_EVM_CHAIN_IDS = Object.freeze(
    CURATED_EVM_CHAINS.map(({ id }) => id),
)

const curatedChainIds = new Set(CURATED_EVM_CHAIN_IDS)
const curatedChainsById = new Map(
    CURATED_EVM_CHAINS.map((chain) => [chain.id, chain]),
)

export function isCuratedEvmChainId(value) {
    return Number.isInteger(Number(value)) &&
        curatedChainIds.has(Number(value))
}

export function getCuratedEvmChain(chainId) {
    return curatedChainsById.get(Number(chainId)) ?? null
}

export function getCuratedEvmChainLogoUri(chainId) {
    const slug = CHAIN_ICON_SLUGS[Number(chainId)]
    return slug
        ? `https://icons.llamao.fi/icons/chains/rsz_${slug}.jpg`
        : null
}

export function isTokenDiscoveryChainId(value) {
    const chainId = Number(value)
    return Number.isInteger(chainId) &&
        TOKEN_DISCOVERY_CHAIN_IDS.includes(chainId)
}

export function requireCuratedEvmChain(chainId) {
    const chain = getCuratedEvmChain(chainId)
    if (!chain) throw new Error('This network is not enabled in PistachioSwap.')
    return chain
}

export function getChainCapabilities(chainId) {
    requireCuratedEvmChain(chainId)
    return Object.freeze({
        send: true,
        sameChainSwap: true,
        crossChainSource: true,
        crossChainDestination: true,
        gasless: Number(chainId) === 56,
        megaFuel: Number(chainId) === MEGAFUEL_CHAIN_ID,
    })
}
