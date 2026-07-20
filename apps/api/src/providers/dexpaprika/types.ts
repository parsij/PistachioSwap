export type DexPaprikaMarketToken = {
    provider: 'dexpaprika'
    chainId: number
    address: string
    name: string
    symbol: string
    decimals: number
    priceUSD: string | null
    marketPriceUSD: string | null
    priceChange24hPercent: number | null
    volume24hUsd: number
    volume7dUsd: number | null
    volume30dUsd: number | null
    liquidityUsd: number
    fdvUsd: number | null
    transactions24h: number
    poolsCount: number | null
    createdAt: string | null
    hasProviderImage: boolean
    recognitionStatus: 'unverified'
    verifiedContract: false
    possibleSpam: null
    securityStatus: 'unknown'
    visibility: 'unverified'
    logoURI: null
    logoCandidates: []
}

export type DexPaprikaMarketTokenResult = {
    tokens: DexPaprikaMarketToken[]
    networkId: string
    partial: boolean
    malformedCount: number
    hasNextPage: boolean
}
