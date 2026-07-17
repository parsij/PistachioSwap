export const CROSS_CHAIN_PROVIDERS = [
    'across',
    'debridge-dln',
    'relay',
    'chainflip',
] as const

export type CrossChainProviderName = (typeof CROSS_CHAIN_PROVIDERS)[number]

export type CrossChainRequest = {
    mode: 'exactIn'
    sourceAsset: CrossChainAsset
    destinationAsset: CrossChainAsset
    amount: string
    ownerAddress: string
    recipient: string
    slippageBps: number
    walletCapabilities: {
        evmTransaction: boolean
        depositChannel: boolean
        vaultSwap: boolean
    }
}

export type CrossChainAsset = {
    chainId: number
    address: string
    symbol: string | null
    decimals: number | null
}

export type ExecutionModel =
    | 'evm-transaction'
    | 'deposit-channel'
    | 'vault-swap'

export type ProviderCapability = {
    sourceChainId: number
    destinationChainId: number
    providerSourceChainId?: number
    providerDestinationChainId?: number
    sellTokens?: readonly string[]
    buyTokens?: readonly string[]
    transactionTargets: readonly string[]
    approvalSpenders?: readonly string[]
}

export type ProviderCapabilities = {
    provider: CrossChainProviderName
    available: boolean
    fetchedAt: string
    routes: readonly ProviderCapability[]
    reason?: string
}

export type CrossChainFee = {
    type: 'bridge' | 'gas' | 'relayer' | 'provider' | 'platform'
    token: string
    amount: string | null
    includedInQuote?: boolean
}

export type CrossChainTransaction = {
    chainId: number
    to: string
    data: string
    value: string
    allowanceTarget: string | null
}

export type CrossChainQuote = {
    provider: CrossChainProviderName
    quoteId: string
    request: CrossChainRequest
    buyAmount: string
    minimumBuyAmount: string
    fees: readonly CrossChainFee[]
    estimatedDurationSeconds: number | null
    executionModel: ExecutionModel
    steps: readonly CrossChainStep[]
    transaction: CrossChainTransaction | null
    deposit: {
        address: string
        asset: CrossChainAsset
        minimumAmount: string
        expiresAt: string
    } | null
    statusId: string | null
    expiresAt: string
}

export type CrossChainStep = {
    id: string
    index: number
    type: 'approval' | 'source-transaction' | 'deposit' | 'wait' | 'destination'
    label: string
    chainId: number | null
    status: 'pending' | 'ready' | 'submitted' | 'confirmed' | 'completed' | 'failed'
    transaction: CrossChainTransaction | null
}

export type CrossChainStatus =
    | 'pending'
    | 'source-confirming'
    | 'in-flight'
    | 'destination-confirming'
    | 'completed'
    | 'failed'
    | 'refunded'
    | 'unknown'

export type CrossChainStatusResult = {
    provider: CrossChainProviderName
    statusId: string
    status: CrossChainStatus
    sourceTransactionHash: string | null
    destinationTransactionHash: string | null
}

export type PublicRouteState =
    | 'quoted'
    | 'prepared'
    | 'awaiting-source'
    | 'source-submitted'
    | 'source-confirmed'
    | 'in-flight'
    | 'destination-confirming'
    | 'completed'
    | 'failed'
    | 'refunded'
    | 'expired'

export type PublicCrossChainRoute = {
    routeId: string
    publicRouteId: string
    quoteId: string
    ownerAddress: string
    provider: CrossChainProviderName
    executionModel: ExecutionModel
    sourceAsset: CrossChainAsset
    destinationAsset: CrossChainAsset
    recipient: string
    inputAmount: string
    outputAmount: string
    minimumOutputAmount: string
    feeAmountUsd: string | null
    durationSeconds: number
    status: PublicRouteState
    providerStatus: string | null
    providerTrackingId: string | null
    sourceTransactionHash: string | null
    destinationTransactionHash: string | null
    failureCode: string | null
    submissionAttempts: number
    claimedAt: string | null
    submittedAt: string | null
    expiresAt: string
    createdAt: string
    updatedAt: string
    steps: CrossChainStep[]
}

export type HttpJson = (
    url: URL,
    options?: {
        method?: 'GET' | 'POST'
        headers?: Record<string, string>
        body?: unknown
        signal?: AbortSignal
        timeoutMs?: number
        retries?: number
        notFoundAsNull?: boolean
    },
) => Promise<unknown>

export interface CrossChainAdapter {
    readonly name: CrossChainProviderName
    getCapabilities(signal?: AbortSignal): Promise<ProviderCapabilities>
    getQuote(
        request: CrossChainRequest,
        capabilities: ProviderCapabilities,
        signal?: AbortSignal,
    ): Promise<CrossChainQuote>
    getStatus(
        statusId: string,
        signal?: AbortSignal,
    ): Promise<CrossChainStatusResult>
    prepare?(
        quote: CrossChainQuote,
        signal?: AbortSignal,
    ): Promise<CrossChainQuote>
}
