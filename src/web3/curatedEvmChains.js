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
export const GAS_ASSIST_CHAIN_ID = 56
export const BNB_CHAIN_LOGO_URI = '/assets/bnb-logo-Ujb8xjX_.png'
export const CANONICAL_NATIVE_TOKEN_ADDRESS =
    '0x0000000000000000000000000000000000000000'

const NATIVE_ERC20_ALIASES = Object.freeze({
    42220: Object.freeze([
        '0x471ece3750da237f93b8e339c536989b8978a438',
    ]),
})

export const WRAPPED_NATIVE_TOKEN_ADDRESSES = Object.freeze({
    1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    10: '0x4200000000000000000000000000000000000006',
    25: '0x5c7f8a570d578ed84e63fd8a1d036d84f42ae23',
    56: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
    100: '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d',
    130: '0x4200000000000000000000000000000000000006',
    137: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
    146: '0x039e2fb66102314ce7b64ce5ce3e5183bc94ad38',
    204: '0x4200000000000000000000000000000000000006',
    324: '0x5aea5775959fbc2557cc8789bc1bf90a239d9a91',
    480: '0x4200000000000000000000000000000000000006',
    1088: '0x75cb093e4d61d2a2ca951a3a4c80a96e8793142',
    1284: '0xacc15dc74880c9944775448304b263d191c6077f',
    5000: '0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8',
    8453: '0x4200000000000000000000000000000000000006',
    34443: '0x4200000000000000000000000000000000000006',
    42161: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    42220: '0x471ece3750da237f93b8e339c536989b8978a438',
    43114: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
    534352: '0x5300000000000000000000000000000000000004',
    59144: '0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f',
    80094: '0x6969696969696969696969696969696969696969',
    81457: '0x4300000000000000000000000000000000000004',
    167000: '0xa51894664a773981c6c112c43ce576f315d5b1b6',
})

const CHAIN_ICON_FILES = Object.freeze({
    1: 'ethereum.svg',
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

export function getWrappedNativeTokenAddress(chainId) {
    return WRAPPED_NATIVE_TOKEN_ADDRESSES[Number(chainId)] ?? null
}

export function isWrappedNativeTokenAddress(chainId, address) {
    const wrappedNativeAddress = getWrappedNativeTokenAddress(chainId)
    return Boolean(wrappedNativeAddress) &&
        String(address ?? '').trim().toLowerCase() === wrappedNativeAddress
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
    if (Number(chainId) === 56) return BNB_CHAIN_LOGO_URI
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
