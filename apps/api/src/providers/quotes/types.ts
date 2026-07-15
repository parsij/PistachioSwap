export type QuoteProviderName = 'uniswap' | '0x' | 'pancakeswap'

export type QuoteRequest = {
    chainId: number
    sellToken: string
    buyToken: string
    sellAmount: string
    sellTokenDecimals: number
    buyTokenDecimals: number
    takerAddress: string
    slippageBps: number
}

export type NormalizedQuote = {
    provider: QuoteProviderName
    quoteId: string
    chainId: number
    sellToken: string
    buyToken: string
    sellAmount: string
    buyAmount: string
    minimumBuyAmount: string
    estimatedGas: string | null
    estimatedGasUsd: string | null
    allowanceTarget: string | null
    transaction: {
        to: string
        data: string
        value: string
        gas?: string
    }
    platformFee: {
        amount: string
        token: string | null
        bps: number
    }
    route: unknown[]
    permitData: unknown | null
    executable: true
    expiresAt: string
}

export type QuoteProvider = {
    name: QuoteProviderName
    supportsChain(chainId: number): boolean
    getQuote(
        request: QuoteRequest,
        signal?: AbortSignal,
    ): Promise<NormalizedQuote>
    healthCheck(signal?: AbortSignal): Promise<boolean>
}

export type QuoteSummary = {
    provider: QuoteProviderName
    status: 'fulfilled' | 'rejected'
    buyAmount: string | null
    minimumBuyAmount: string | null
    estimatedGasUsd: string | null
    platformFee: NormalizedQuote['platformFee'] | null
    error: string | null
}

export type QuoteSelection = {
    selectedQuote: NormalizedQuote
    providers: QuoteSummary[]
}
