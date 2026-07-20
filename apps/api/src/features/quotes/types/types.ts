export type QuoteProviderName = 'uniswap' | '0x' | 'pancakeswap'

export type QuoteRequest = {
    chainId: number
    sellToken: string
    buyToken: string
    mode: 'EXACT_INPUT' | 'EXACT_OUTPUT'
    sellAmount: string
    buyAmount: string | null
    sellTokenDecimals: number
    buyTokenDecimals: number
    takerAddress: string
    slippageBps: number
}

export type NormalizedQuote = {
    provider: QuoteProviderName
    billingMode: 'provider-integrator' | 'prepaid-megafuel' | 'normal-provider-fee'
    quoteId: string
    chainId: number
    sellToken: string
    buyToken: string
    mode: QuoteRequest['mode']
    sellAmount: string
    buyAmount: string
    minimumBuyAmount: string
    maximumSellAmount: string
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
        configuredBps?: number
        effectiveBps?: number
        adjustment?: 'base' | 'minimum-chargeable' | 'usd-cap'
        capped?: boolean
    }
    approval?: {
        mode: 'erc20' | 'permit2-allowance'
        token: string
        spender: string
        contract: string
        requiredAmount: string
    } | null
    route: unknown[]
    permitData: unknown | null
    executable: true
    expiresAt: string
}

export type QuoteProvider = {
    name: QuoteProviderName
    supportsChain(chainId: number): boolean
    supportsQuoteMode(mode: QuoteRequest['mode']): boolean
    getQuote(
        request: QuoteRequest,
        signal?: AbortSignal,
    ): Promise<NormalizedQuote>
    healthCheck(signal?: AbortSignal): Promise<boolean>
}

export type QuoteSummary = {
    provider: QuoteProviderName
    status: 'fulfilled' | 'rejected' | 'skipped'
    category?:
        | 'valid-route'
        | 'no-route'
        | 'amount-below-provider-minimum'
        | 'no-liquidity'
        | 'unsupported-token'
        | 'timeout'
        | 'rate-limited'
        | 'temporary-failure'
        | 'malformed-or-unsafe-quote'
        | 'configuration-error'
        | 'skipped-not-eligible'
    buyAmount: string | null
    minimumBuyAmount: string | null
    maximumSellAmount: string | null
    estimatedGasUsd: string | null
    platformFee: NormalizedQuote['platformFee'] | null
    minimumInputAmountUsd?: string | null
    retryable: boolean | null
    error: string | null
}

export type QuoteSelection = {
    approvalSchemaVersion: 1
    selectedQuote: NormalizedQuote
    providers: QuoteSummary[]
    swapIntentId?: string
    gasAssistCompatible?: boolean
}
