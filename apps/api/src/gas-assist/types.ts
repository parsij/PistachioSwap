export const ZEROX_NATIVE_TOKEN = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
export const UINT256_MAX = (2n ** 256n - 1n).toString()

export type TypedDataField = { name: string; type: string }
export type ZeroXTypedData = {
    types: Record<string, TypedDataField[]>
    primaryType: string
    domain: Record<string, unknown>
    message: Record<string, unknown>
}

export type ZeroXSigningObject = {
    type: string
    hash?: string
    eip712: ZeroXTypedData
}

export type StoredGaslessQuote = {
    id: string
    sponsorshipOrderId: string | null
    billingMode: 'provider-integrator' | 'prepaid-megafuel'
    zid: string | null
    chainId: number
    walletAddress: string
    sellTokenAddress: string
    buyTokenAddress: string
    requestedSellAmount: string
    quotedSellAmount: string
    buyAmount: string
    minimumBuyAmount: string
    fees: Record<string, unknown>
    route: Record<string, unknown>
    approval: ZeroXSigningObject | null
    trade: ZeroXSigningObject
    approvalRequired: boolean
    gaslessApprovalAvailable: boolean
    approvalAmount: string | null
    approvalUnlimited: boolean
    status: string
    expiresAt: Date
    tradeHash: string | null
    transactionHash: string | null
    providerStatus: string | null
    approvalSignatureHash: string | null
    tradeSignatureHash: string | null
    submissionAttempts: number
    lastStatusCheckedAt: Date | null
}
