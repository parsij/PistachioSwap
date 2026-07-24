import { NATIVE_TOKEN_ADDRESS } from '../lib/address.js'

export type TokenDiscoveryCapabilities = Readonly<{
    geckoTerminal: boolean
    coinGeckoOnchain: boolean
    dexScreener: boolean
    moralis: boolean
    alchemy: boolean
    rpcFallback: boolean
    honeypot: boolean
    goPlus: boolean
    curatedLists: boolean
}>

export type TokenDiscoveryChain = Readonly<{
    chainId: number
    name: string
    active: boolean
    native: Readonly<{
        address: typeof NATIVE_TOKEN_ADDRESS
        name: string
        symbol: string
        decimals: number
        coinGeckoId: string
        erc20Aliases: readonly `0x${string}`[]
    }>
    wrappedNative: Readonly<{
        address: `0x${string}`
        name: string
        symbol: string
        decimals: number
    }>
    chainLogoURI: string
    providers: Readonly<{
        geckoTerminalNetwork: string
        coinGeckoNetwork: string
        dexScreenerChain: string
        moralisChain: string | null
        alchemyNetwork: string | null
        rpcEnv: string | null
        goPlusChainId: string | null
    }>
    capabilities: TokenDiscoveryCapabilities
}>

export type TokenDiscoveryWalletCapability = Readonly<{
    chainId: number
    name: string
    active: boolean
    unchainedSupported: boolean
    unchainedCoinstack: string | null
    localUnchainedPort: number | null
    walletFallbackProviders: readonly string[]
    fallbackCatalogAvailable: boolean
}>

type Entry = Omit<TokenDiscoveryChain, 'native' | 'wrappedNative' | 'chainLogoURI' | 'capabilities'> & {
    native: Omit<TokenDiscoveryChain['native'], 'address' | 'decimals' | 'erc20Aliases'> & {
        erc20Aliases?: readonly `0x${string}`[]
    }
    wrappedNative: Omit<TokenDiscoveryChain['wrappedNative'], 'decimals'>
    capabilities?: Partial<TokenDiscoveryCapabilities>
}

const chainIconFiles: Readonly<Record<number, string>> = Object.freeze({
    1: 'ethereum.svg', 56: 'bsc.webp', 137: 'polygon.webp', 42161: 'arbitrum.webp',
    10: 'optimism.webp', 8453: 'base.webp', 43114: 'avalanche.webp', 42220: 'celo.webp',
    100: 'gnosis.webp', 59144: 'linea.webp', 534352: 'scroll.webp', 324: 'zksync-era.webp',
    5000: 'mantle.webp', 146: 'sonic.webp', 80094: 'berachain.webp', 130: 'unichain.webp',
    480: 'world-chain.webp', 81457: 'blast.webp', 34443: 'mode.webp', 1088: 'metis.webp',
    25: 'cronos.webp', 1284: 'moonbeam.webp', 167000: 'taiko.webp', 204: 'opbnb.webp',
    1101: 'polygon-zkevm.webp',
})

const logo = (chainId: number) =>
    `/networkIcons/${chainIconFiles[chainId]}`

const entries: readonly Entry[] = [
    { chainId: 1, name: 'Ethereum', active: true, native: { name: 'Ether', symbol: 'ETH', coinGeckoId: 'ethereum' }, wrappedNative: { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', name: 'Wrapped Ether', symbol: 'WETH' }, providers: { geckoTerminalNetwork: 'eth', coinGeckoNetwork: 'eth', dexScreenerChain: 'ethereum', moralisChain: 'eth', alchemyNetwork: 'eth-mainnet', rpcEnv: 'ETHEREUM_RPC_URL', goPlusChainId: '1' } },
    { chainId: 56, name: 'BNB Chain', active: true, native: { name: 'BNB', symbol: 'BNB', coinGeckoId: 'binancecoin' }, wrappedNative: { address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', name: 'Wrapped BNB', symbol: 'WBNB' }, providers: { geckoTerminalNetwork: 'bsc', coinGeckoNetwork: 'bsc', dexScreenerChain: 'bsc', moralisChain: 'bsc', alchemyNetwork: 'bnb-mainnet', rpcEnv: 'BSC_RPC_URL', goPlusChainId: '56' }, capabilities: { curatedLists: true } },
    { chainId: 137, name: 'Polygon PoS', active: true, native: { name: 'POL', symbol: 'POL', coinGeckoId: 'matic-network' }, wrappedNative: { address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', name: 'Wrapped POL', symbol: 'WPOL' }, providers: { geckoTerminalNetwork: 'polygon_pos', coinGeckoNetwork: 'polygon_pos', dexScreenerChain: 'polygon', moralisChain: 'polygon', alchemyNetwork: 'polygon-mainnet', rpcEnv: 'POLYGON_RPC_URL', goPlusChainId: '137' } },
    { chainId: 42161, name: 'Arbitrum One', active: true, native: { name: 'Ether', symbol: 'ETH', coinGeckoId: 'ethereum' }, wrappedNative: { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', name: 'Wrapped Ether', symbol: 'WETH' }, providers: { geckoTerminalNetwork: 'arbitrum', coinGeckoNetwork: 'arbitrum', dexScreenerChain: 'arbitrum', moralisChain: 'arbitrum', alchemyNetwork: 'arb-mainnet', rpcEnv: 'ARBITRUM_RPC_URL', goPlusChainId: '42161' } },
    { chainId: 10, name: 'OP Mainnet', active: true, native: { name: 'Ether', symbol: 'ETH', coinGeckoId: 'ethereum' }, wrappedNative: { address: '0x4200000000000000000000000000000000000006', name: 'Wrapped Ether', symbol: 'WETH' }, providers: { geckoTerminalNetwork: 'optimism', coinGeckoNetwork: 'optimism', dexScreenerChain: 'optimism', moralisChain: 'optimism', alchemyNetwork: 'opt-mainnet', rpcEnv: 'OPTIMISM_RPC_URL', goPlusChainId: '10' } },
    { chainId: 8453, name: 'Base', active: true, native: { name: 'Ether', symbol: 'ETH', coinGeckoId: 'ethereum' }, wrappedNative: { address: '0x4200000000000000000000000000000000000006', name: 'Wrapped Ether', symbol: 'WETH' }, providers: { geckoTerminalNetwork: 'base', coinGeckoNetwork: 'base', dexScreenerChain: 'base', moralisChain: 'base', alchemyNetwork: 'base-mainnet', rpcEnv: 'BASE_RPC_URL', goPlusChainId: '8453' } },
    { chainId: 43114, name: 'Avalanche C-Chain', active: true, native: { name: 'Avalanche', symbol: 'AVAX', coinGeckoId: 'avalanche-2' }, wrappedNative: { address: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7', name: 'Wrapped AVAX', symbol: 'WAVAX' }, providers: { geckoTerminalNetwork: 'avax', coinGeckoNetwork: 'avax', dexScreenerChain: 'avalanche', moralisChain: 'avalanche', alchemyNetwork: 'avax-mainnet', rpcEnv: 'AVALANCHE_RPC_URL', goPlusChainId: '43114' } },
    { chainId: 42220, name: 'Celo', active: true, native: { name: 'Celo', symbol: 'CELO', coinGeckoId: 'celo', erc20Aliases: ['0x471ece3750da237f93b8e339c536989b8978a438'] }, wrappedNative: { address: '0x471ece3750da237f93b8e339c536989b8978a438', name: 'Celo', symbol: 'CELO' }, providers: { geckoTerminalNetwork: 'celo', coinGeckoNetwork: 'celo', dexScreenerChain: 'celo', moralisChain: null, alchemyNetwork: 'celo-mainnet', rpcEnv: 'CELO_RPC_URL', goPlusChainId: '42220' } },
    { chainId: 100, name: 'Gnosis Chain', active: true, native: { name: 'xDAI', symbol: 'xDAI', coinGeckoId: 'xdai' }, wrappedNative: { address: '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d', name: 'Wrapped xDAI', symbol: 'WXDAI' }, providers: { geckoTerminalNetwork: 'xdai', coinGeckoNetwork: 'xdai', dexScreenerChain: 'gnosis', moralisChain: 'gnosis', alchemyNetwork: 'gnosis-mainnet', rpcEnv: 'GNOSIS_RPC_URL', goPlusChainId: '100' } },
    { chainId: 59144, name: 'Linea', active: true, native: { name: 'Ether', symbol: 'ETH', coinGeckoId: 'ethereum' }, wrappedNative: { address: '0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f', name: 'Wrapped Ether', symbol: 'WETH' }, providers: { geckoTerminalNetwork: 'linea', coinGeckoNetwork: 'linea', dexScreenerChain: 'linea', moralisChain: 'linea', alchemyNetwork: 'linea-mainnet', rpcEnv: 'LINEA_RPC_URL', goPlusChainId: '59144' } },
    { chainId: 534352, name: 'Scroll', active: true, native: { name: 'Ether', symbol: 'ETH', coinGeckoId: 'ethereum' }, wrappedNative: { address: '0x5300000000000000000000000000000000000004', name: 'Wrapped Ether', symbol: 'WETH' }, providers: { geckoTerminalNetwork: 'scroll', coinGeckoNetwork: 'scroll', dexScreenerChain: 'scroll', moralisChain: null, alchemyNetwork: 'scroll-mainnet', rpcEnv: 'SCROLL_RPC_URL', goPlusChainId: '534352' } },
    { chainId: 324, name: 'ZKsync Era', active: true, native: { name: 'Ether', symbol: 'ETH', coinGeckoId: 'ethereum' }, wrappedNative: { address: '0x5aea5775959fbc2557cc8789bc1bf90a239d9a91', name: 'Wrapped Ether', symbol: 'WETH' }, providers: { geckoTerminalNetwork: 'zksync', coinGeckoNetwork: 'zksync', dexScreenerChain: 'zksync', moralisChain: null, alchemyNetwork: 'zksync-mainnet', rpcEnv: 'ZKSYNC_RPC_URL', goPlusChainId: '324' } },
    { chainId: 5000, name: 'Mantle', active: true, native: { name: 'Mantle', symbol: 'MNT', coinGeckoId: 'mantle' }, wrappedNative: { address: '0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8', name: 'Wrapped Mantle', symbol: 'WMNT' }, providers: { geckoTerminalNetwork: 'mantle', coinGeckoNetwork: 'mantle', dexScreenerChain: 'mantle', moralisChain: null, alchemyNetwork: 'mantle-mainnet', rpcEnv: 'MANTLE_RPC_URL', goPlusChainId: '5000' } },
    { chainId: 146, name: 'Sonic', active: true, native: { name: 'Sonic', symbol: 'S', coinGeckoId: 'sonic-3' }, wrappedNative: { address: '0x039e2fb66102314ce7b64ce5ce3e5183bc94ad38', name: 'Wrapped Sonic', symbol: 'wS' }, providers: { geckoTerminalNetwork: 'sonic', coinGeckoNetwork: 'sonic', dexScreenerChain: 'sonic', moralisChain: null, alchemyNetwork: 'sonic-mainnet', rpcEnv: 'SONIC_RPC_URL', goPlusChainId: null } },
    { chainId: 80094, name: 'Berachain', active: true, native: { name: 'Bera', symbol: 'BERA', coinGeckoId: 'berachain-bera' }, wrappedNative: { address: '0x6969696969696969696969696969696969696969', name: 'Wrapped Bera', symbol: 'WBERA' }, providers: { geckoTerminalNetwork: 'berachain', coinGeckoNetwork: 'berachain', dexScreenerChain: 'berachain', moralisChain: null, alchemyNetwork: 'berachain-mainnet', rpcEnv: 'BERACHAIN_RPC_URL', goPlusChainId: null } },
    { chainId: 130, name: 'Unichain', active: true, native: { name: 'Ether', symbol: 'ETH', coinGeckoId: 'ethereum' }, wrappedNative: { address: '0x4200000000000000000000000000000000000006', name: 'Wrapped Ether', symbol: 'WETH' }, providers: { geckoTerminalNetwork: 'unichain', coinGeckoNetwork: 'unichain', dexScreenerChain: 'unichain', moralisChain: null, alchemyNetwork: 'unichain-mainnet', rpcEnv: 'UNICHAIN_RPC_URL', goPlusChainId: null } },
    { chainId: 480, name: 'World Chain', active: true, native: { name: 'Ether', symbol: 'ETH', coinGeckoId: 'ethereum' }, wrappedNative: { address: '0x4200000000000000000000000000000000000006', name: 'Wrapped Ether', symbol: 'WETH' }, providers: { geckoTerminalNetwork: 'world-chain', coinGeckoNetwork: 'world-chain', dexScreenerChain: 'worldchain', moralisChain: null, alchemyNetwork: 'worldchain-mainnet', rpcEnv: 'WORLDCHAIN_RPC_URL', goPlusChainId: null } },
    { chainId: 81457, name: 'Blast', active: true, native: { name: 'Ether', symbol: 'ETH', coinGeckoId: 'ethereum' }, wrappedNative: { address: '0x4300000000000000000000000000000000000004', name: 'Wrapped Ether', symbol: 'WETH' }, providers: { geckoTerminalNetwork: 'blast', coinGeckoNetwork: 'blast', dexScreenerChain: 'blast', moralisChain: null, alchemyNetwork: 'blast-mainnet', rpcEnv: 'BLAST_RPC_URL', goPlusChainId: null } },
    { chainId: 34443, name: 'Mode', active: true, native: { name: 'Ether', symbol: 'ETH', coinGeckoId: 'ethereum' }, wrappedNative: { address: '0x4200000000000000000000000000000000000006', name: 'Wrapped Ether', symbol: 'WETH' }, providers: { geckoTerminalNetwork: 'mode', coinGeckoNetwork: 'mode', dexScreenerChain: 'mode', moralisChain: null, alchemyNetwork: 'shape-mainnet', rpcEnv: 'MODE_RPC_URL', goPlusChainId: null }, capabilities: { alchemy: false } },
    { chainId: 1088, name: 'Metis Andromeda', active: true, native: { name: 'Metis', symbol: 'METIS', coinGeckoId: 'metis-token' }, wrappedNative: { address: '0x75cb093e4d61d2a2ca951a3a4c80a96e8793142', name: 'Wrapped Metis', symbol: 'WMETIS' }, providers: { geckoTerminalNetwork: 'metis', coinGeckoNetwork: 'metis', dexScreenerChain: 'metis', moralisChain: null, alchemyNetwork: null, rpcEnv: 'METIS_RPC_URL', goPlusChainId: null } },
    { chainId: 25, name: 'Cronos', active: true, native: { name: 'Cronos', symbol: 'CRO', coinGeckoId: 'crypto-com-chain' }, wrappedNative: { address: '0x5c7f8a570d578ed84e63fd8a1d036d84f42ae23', name: 'Wrapped CRO', symbol: 'WCRO' }, providers: { geckoTerminalNetwork: 'cro', coinGeckoNetwork: 'cro', dexScreenerChain: 'cronos', moralisChain: null, alchemyNetwork: null, rpcEnv: 'CRONOS_RPC_URL', goPlusChainId: '25' } },
    { chainId: 1284, name: 'Moonbeam', active: true, native: { name: 'Glimmer', symbol: 'GLMR', coinGeckoId: 'moonbeam' }, wrappedNative: { address: '0xacc15dc74880c9944775448304b263d191c6077f', name: 'Wrapped Glimmer', symbol: 'WGLMR' }, providers: { geckoTerminalNetwork: 'moonbeam', coinGeckoNetwork: 'moonbeam', dexScreenerChain: 'moonbeam', moralisChain: null, alchemyNetwork: null, rpcEnv: 'MOONBEAM_RPC_URL', goPlusChainId: '1284' } },
    { chainId: 167000, name: 'Taiko', active: true, native: { name: 'Ether', symbol: 'ETH', coinGeckoId: 'ethereum' }, wrappedNative: { address: '0xa51894664a773981c6c112c43ce576f315d5b1b6', name: 'Wrapped Ether', symbol: 'WETH' }, providers: { geckoTerminalNetwork: 'taiko', coinGeckoNetwork: 'taiko', dexScreenerChain: 'taiko', moralisChain: null, alchemyNetwork: null, rpcEnv: 'TAIKO_RPC_URL', goPlusChainId: null } },
    { chainId: 204, name: 'opBNB', active: true, native: { name: 'BNB', symbol: 'BNB', coinGeckoId: 'binancecoin' }, wrappedNative: { address: '0x4200000000000000000000000000000000000006', name: 'Wrapped BNB', symbol: 'WBNB' }, providers: { geckoTerminalNetwork: 'opbnb', coinGeckoNetwork: 'opbnb', dexScreenerChain: 'opbnb', moralisChain: null, alchemyNetwork: 'opbnb-mainnet', rpcEnv: 'OPBNB_RPC_URL', goPlusChainId: '204' } },
    { chainId: 1101, name: 'Polygon zkEVM', active: false, native: { name: 'Ether', symbol: 'ETH', coinGeckoId: 'ethereum' }, wrappedNative: { address: '0x4f9a0e7fd2b1e5b7a1ab68fda3c29a366b9ba5d4', name: 'Wrapped Ether', symbol: 'WETH' }, providers: { geckoTerminalNetwork: 'polygon-zkevm', coinGeckoNetwork: 'polygon-zkevm', dexScreenerChain: 'polygonzkevm', moralisChain: null, alchemyNetwork: 'polygonzkevm-mainnet', rpcEnv: 'POLYGON_ZKEVM_RPC_URL', goPlusChainId: '1101' }, capabilities: { geckoTerminal: false, coinGeckoOnchain: false, dexScreener: false, alchemy: false, rpcFallback: false, goPlus: false } },
] as const

// Provider support is deliberately independent from the presence of a slug.
// Update these sets only when the corresponding provider mapping is verified.
const GECKOTERMINAL_CHAIN_IDS = new Set([
    1, 10, 25, 56, 100, 130, 137, 146, 204, 324, 480, 1088, 1284,
    5000, 8453, 34443, 42161, 42220, 43114, 59144, 80094, 81457,
    167000, 534352,
])
const COINGECKO_ONCHAIN_CHAIN_IDS = new Set([
    1, 10, 25, 56, 100, 130, 137, 146, 204, 324, 480, 1088, 1284,
    5000, 8453, 34443, 42161, 42220, 43114, 59144, 80094, 81457,
    167000, 534352,
])
const DEXSCREENER_CHAIN_IDS = new Set([
    1, 10, 25, 56, 100, 130, 137, 146, 204, 324, 480, 1088, 1284,
    5000, 8453, 34443, 42161, 42220, 43114, 59144, 80094, 81457,
    167000, 534352,
])

const defaultCapabilities: TokenDiscoveryCapabilities = {
    geckoTerminal: false,
    coinGeckoOnchain: false,
    dexScreener: false,
    moralis: false,
    alchemy: false,
    rpcFallback: true,
    honeypot: false,
    goPlus: false,
    curatedLists: false,
}

export const UNCHAINED_EVM_COINSTACKS_BY_CHAIN_ID: Readonly<Record<number, {
    coinstack: string
    localPort: number
}>> = Object.freeze({
    1: { coinstack: 'ethereum', localPort: 3101 },
    10: { coinstack: 'optimism', localPort: 3110 },
    56: { coinstack: 'bnbsmartchain', localPort: 3156 },
    100: { coinstack: 'gnosis', localPort: 3100 },
    137: { coinstack: 'polygon', localPort: 3137 },
    8453: { coinstack: 'base', localPort: 3453 },
    42161: { coinstack: 'arbitrum', localPort: 3161 },
    43114: { coinstack: 'avalanche', localPort: 3114 },
})

export const TOKEN_DISCOVERY_CHAINS: readonly TokenDiscoveryChain[] = Object.freeze(
    entries.map((entry) => Object.freeze({
        ...entry,
        native: Object.freeze({
            ...entry.native,
            address: NATIVE_TOKEN_ADDRESS,
            decimals: 18,
            erc20Aliases: Object.freeze([...(entry.native.erc20Aliases ?? [])]),
        }),
        wrappedNative: Object.freeze({ ...entry.wrappedNative, decimals: 18 }),
        chainLogoURI: logo(entry.chainId),
        capabilities: Object.freeze({
            ...defaultCapabilities,
            geckoTerminal: GECKOTERMINAL_CHAIN_IDS.has(entry.chainId),
            coinGeckoOnchain: COINGECKO_ONCHAIN_CHAIN_IDS.has(entry.chainId),
            dexScreener: DEXSCREENER_CHAIN_IDS.has(entry.chainId),
            moralis: entry.providers.moralisChain !== null,
            alchemy: entry.providers.alchemyNetwork !== null,
            honeypot: [1, 56, 8453].includes(entry.chainId),
            goPlus: entry.providers.goPlusChainId !== null,
            ...entry.capabilities,
        }),
        providers: Object.freeze({ ...entry.providers }),
    })),
)

export const ACTIVE_TOKEN_DISCOVERY_CHAINS = Object.freeze(
    TOKEN_DISCOVERY_CHAINS.filter((chain) => chain.active),
)

export function getWalletFallbackProviders(chain: TokenDiscoveryChain) {
    return [
        chain.capabilities.alchemy ? 'alchemy' : null,
        chain.capabilities.moralis ? 'moralis' : null,
        chain.capabilities.rpcFallback ? 'rpc' : null,
        'fallback-catalog',
    ].filter((value): value is string => value !== null)
}

export const ACTIVE_TOKEN_DISCOVERY_WALLET_CAPABILITIES:
readonly TokenDiscoveryWalletCapability[] = Object.freeze(
    ACTIVE_TOKEN_DISCOVERY_CHAINS.map((chain) => {
        const unchained = UNCHAINED_EVM_COINSTACKS_BY_CHAIN_ID[chain.chainId] ?? null
        return Object.freeze({
            chainId: chain.chainId,
            name: chain.name,
            active: true,
            unchainedSupported: unchained !== null,
            unchainedCoinstack: unchained?.coinstack ?? null,
            localUnchainedPort: unchained?.localPort ?? null,
            walletFallbackProviders: Object.freeze(getWalletFallbackProviders(chain)),
            fallbackCatalogAvailable: true,
        })
    }),
)

const byId = new Map(TOKEN_DISCOVERY_CHAINS.map((chain) => [chain.chainId, chain]))
const byDexScreenerId = new Map(
    ACTIVE_TOKEN_DISCOVERY_CHAINS.map((chain) => [
        chain.providers.dexScreenerChain,
        chain,
    ]),
)

export function getTokenDiscoveryChain(chainId: number) {
    return byId.get(chainId) ?? null
}

export function canonicalTokenAddress(chainId: number, address: string) {
    const normalized = address.toLowerCase()
    const chain = getTokenDiscoveryChain(chainId)
    return normalized === NATIVE_TOKEN_ADDRESS ||
        chain?.native.erc20Aliases.includes(normalized as `0x${string}`)
        ? NATIVE_TOKEN_ADDRESS
        : normalized
}

export function hasMarketProviderCapability(
    chainId: number,
    provider: 'geckoterminal' | 'coingecko' | 'dexscreener',
) {
    const chain = getTokenDiscoveryChain(chainId)
    if (!chain?.active) return false
    if (provider === 'geckoterminal') return chain.capabilities.geckoTerminal
    if (provider === 'coingecko') return chain.capabilities.coinGeckoOnchain
    return chain.capabilities.dexScreener
}

export function getTokenDiscoveryChainByDexScreenerId(value: string) {
    return byDexScreenerId.get(value) ?? null
}

export function requireActiveTokenDiscoveryChain(chainId: number) {
    const chain = getTokenDiscoveryChain(chainId)
    if (!chain?.active) throw new Error('Chain is not enabled for token discovery.')
    return chain
}
