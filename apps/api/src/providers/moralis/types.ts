export type MoralisWalletToken = {
    chainId: 56
    address: string
    possibleSpam: boolean | null
    verifiedContract: boolean | null
    name: string | null
    symbol: string | null
    decimals: number | null
    logoURI: string | null
    priceUSD: string | null
    valueUSD: string | null
    source: 'moralis'
}

export type MoralisWalletTokenResult = {
    available: boolean
    checkedAt: string | null
    tokens: Map<string, MoralisWalletToken>
    pageCount: number
}
