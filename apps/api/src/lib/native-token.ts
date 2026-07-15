import { NATIVE_TOKEN_ADDRESS, createTokenId } from './address.js'

export const NATIVE_BNB_TOKEN = Object.freeze({
    id: createTokenId(56, NATIVE_TOKEN_ADDRESS),
    chainId: 56 as const,
    address: NATIVE_TOKEN_ADDRESS,
    name: 'BNB',
    symbol: 'BNB',
    decimals: 18,
    logoURI: '/icons/BSC.svg',
    logoCandidates: ['/icons/BSC.svg'],
    logoSource: 'local' as const,
    chainLogoURI: '/icons/BSC.svg',
    coinGeckoId: 'binancecoin',
    isNative: true as const,
    verificationStatus: 'established' as const,
    verificationReasons: ['explicit-native-allowlist'],
    visibility: 'primary' as const,
    visibilityReasons: ['native-bnb'],
})

export function nativeBnbMarketToken(priceUSD: string | null = null) {
    return {
        ...NATIVE_BNB_TOKEN,
        priceUSD,
        volume24hUsd: 0,
        liquidityUsd: 0,
        pairCount: 0,
        oldestPairCreatedAt: null,
        marketUrl: null,
        rank: 1,
    }
}
