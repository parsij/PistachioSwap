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
export const CANONICAL_NATIVE_TOKEN_ADDRESS =
    '0x0000000000000000000000000000000000000000'

const NATIVE_ERC20_ALIASES = Object.freeze({
    42220: Object.freeze([
        '0x471ece3750da237f93b8e339c536989b8978a438',
    ]),
})

const CHAIN_ICON_FILES = Object.freeze({
    1: 'ethereum.svg',
    56: 'bsc.webp',
    137: 'polygon.webp',
    42161: 'arbitrum.webp',
    10: 'optimism.webp',
    8453: 'base.webp',
    43114: 'avalanche.webp',
    42220: 'celo.webp',
    100: 'gnosis.webp',
    59144: 'linea.webp',
    534352: 'scroll.webp',
    324: 'zksync-era.webp',
    5000: 'mantle.webp',
    146: 'sonic.webp',
    80094: 'berachain.webp',
    130: 'unichain.webp',
    480: 'world-chain.webp',
    81457: 'blast.webp',
    34443: 'mode.webp',
    1088: 'metis.webp',
    25: 'cronos.webp',
    1284: 'moonbeam.webp',
    167000: 'taiko.webp',
    204: 'opbnb.webp',
    1101: 'polygon-zkevm.webp',
})

const CHAIN_ICON_BASE_PATH = '/networkIcons'

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

export function getNativeTokenAliases(chainId) {
    return NATIVE_ERC20_ALIASES[Number(chainId)] ?? Object.freeze([])
}

export function getCanonicalTokenAddress(chainId, address) {
    const normalized = String(address ?? '').trim().toLowerCase()
    if (normalized === CANONICAL_NATIVE_TOKEN_ADDRESS ||
        getNativeTokenAliases(chainId).includes(normalized)) {
        return CANONICAL_NATIVE_TOKEN_ADDRESS
    }
    return /^0x[a-f0-9]{40}$/.test(normalized) ? normalized : null
}

export function getCuratedEvmChainLogoUri(chainId) {
    const fileName = CHAIN_ICON_FILES[Number(chainId)]
    return fileName
        ? `${CHAIN_ICON_BASE_PATH}/${fileName}`
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
