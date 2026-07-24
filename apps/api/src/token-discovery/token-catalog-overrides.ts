import { NATIVE_TOKEN_ADDRESS, createTokenId, normalizeAddress } from '../lib/address.js'
import {
    ACTIVE_TOKEN_DISCOVERY_CHAINS,
    type TokenDiscoveryChain,
} from './registry.js'

export type TokenCatalogOverride = Readonly<{
    displayName?: string
    displaySymbol?: string
    searchAliases?: readonly string[]
    featuredRank?: number
    hiddenFromFeatured?: boolean
}>

const BNB_CHAIN_ID = 56

export const TOKEN_CATALOG_OVERRIDES: Readonly<Record<string, TokenCatalogOverride>> = Object.freeze({
    [createTokenId(BNB_CHAIN_ID, '0x55d398326f99059ff775485246999027b3197955')]: Object.freeze({
        displayName: 'Tether USD',
        displaySymbol: 'USDT',
        searchAliases: Object.freeze(['USDT', 'Tether USD', 'BSC-USD']),
        featuredRank: 2,
    }),
})

const BNB_FEATURED_ADDRESSES = [
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
    '0x55d398326f99059ff775485246999027b3197955',
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3',
    '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',
    '0x2170ed0880ac9a755fd29b2688956bd959f933f8',
    '0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd',
    '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
    '0xfb6115445bff7b52feb98650c87f44907e58f802',
    '0x4b0f1812e5df2a09796481ff14017e6005508003',
] as const

export function getTokenCatalogOverride(chainId: number, address: string) {
    const normalized = normalizeAddress(address)
    return normalized ? TOKEN_CATALOG_OVERRIDES[createTokenId(chainId, normalized)] ?? null : null
}

export function getFeaturedTokenAddresses(chain: TokenDiscoveryChain): readonly string[] {
    const addresses = chain.chainId === BNB_CHAIN_ID
        ? BNB_FEATURED_ADDRESSES
        : [chain.wrappedNative.address]
    return [...new Set(addresses.map((address) => normalizeAddress(address)).filter(
        (address): address is string => Boolean(address) && address !== NATIVE_TOKEN_ADDRESS,
    ))]
}

export function getFeaturedTokenCountsByChain() {
    return Object.fromEntries(
        ACTIVE_TOKEN_DISCOVERY_CHAINS.map((chain) => [
            chain.chainId,
            getFeaturedTokenAddresses(chain).length,
        ]),
    )
}

export function isPoolVaultOrReceiptToken({
    name,
    symbol,
}: {
    name: string
    symbol: string
}) {
    const normalizedName = name.toLowerCase()
    const normalizedSymbol = symbol.toLowerCase()
    if (/\b(lp|pool|vault|receipt token)\b/u.test(normalizedName)) return true
    if (/^(a|v|e)[a-z0-9+-]*(usdt|usdc|dai|weth|wbtc|bnb|btc|eth)$/u.test(normalizedSymbol)) return true
    if (/^(abnb|vbnb|vbusd|vusdt|vusdc|vdai|eweth|eusdt|eusdc|edai)/u.test(normalizedSymbol)) return true
    if (/(\*usdt|lp|pool|vault)$/u.test(normalizedSymbol)) return true
    if (/\b(aave|venus|euler|lista|stargate)\b.*\b(pool|vault|lp)\b/u.test(normalizedName)) return true
    return false
}
