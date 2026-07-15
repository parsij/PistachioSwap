export type HoneypotRisk =
    | 'unknown'
    | 'very_low'
    | 'low'
    | 'medium'
    | 'high'
    | 'very_high'
    | 'honeypot'

export type HoneypotFlag = {
    code: string
    severity: string | null
    description: string | null
}

export type HoneypotTokenSecurity = {
    provider: 'honeypot'
    chainId: 56
    address: string
    available: boolean
    checkedAt: string
    risk: HoneypotRisk
    riskLevel: number | null
    isHoneypot: boolean | null
    honeypotReason: string | null
    simulationSuccess: boolean | null
    buyTaxPercent: string | null
    sellTaxPercent: string | null
    transferTaxPercent: string | null
    holderFailureCount: number | null
    holderSiphonedCount: number | null
    contractOpenSource: boolean | null
    rootContractOpenSource: boolean | null
    isProxy: boolean | null
    liquidityUsd: string | null
    pairAddress: string | null
    flags: HoneypotFlag[]
}

export type GoPlusTokenSecurity = {
    provider: 'goplus'
    chainId: 56
    address: string
    available: boolean
    checkedAt: string
    isHoneypot: boolean | null
    cannotBuy: boolean | null
    cannotSellAll: boolean | null
    hasBlacklist: boolean | null
    hasWhitelist: boolean | null
    transferPausable: boolean | null
    taxModifiable: boolean | null
    personalTaxModifiable: boolean | null
    ownerCanChangeBalance: boolean | null
    hiddenOwner: boolean | null
    openSource: boolean | null
    isProxy: boolean | null
    buyTaxFraction: string | null
    sellTaxFraction: string | null
    transferTaxFraction: string | null
    holderCount: string | null
    dexLiquidityUsd: string | null
}

export type SecurityStatus =
    | 'trusted'
    | 'low'
    | 'caution'
    | 'high'
    | 'blocked'
    | 'unknown'

export type TokenSecurityAssessment = {
    chainId: 56
    address: string
    securityStatus: SecurityStatus
    securityScore: number | null
    securityReasons: string[]
    honeypot: HoneypotTokenSecurity
    goPlus: GoPlusTokenSecurity
}
