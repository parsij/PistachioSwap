import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../../lib/address.js'

export type PaymentTokenCandidate = {
    chainId: number
    tokenAddress: string
    symbol: string
    decimals: number
    onchainDecimals: number
    enabled: boolean
    feePaymentEnabled: boolean
    isStablecoin: boolean
    paymentPriority: number
    minimumLiquidityUsdMicros: bigint
    maximumPriceAgeSeconds: number
    maximumPriceDeviationBps: number
    exactTransferRequired: boolean
    feeOnTransferAllowed: boolean
    rebasingAllowed: boolean
    strictSecurityRequired: boolean
    priceUsdMicros: bigint
    priceObservedAt: Date
    priceDeviationBps: number
    liquidityUsdMicros: bigint
    balanceRaw: bigint
    transferBehavior: 'exact' | 'fee-on-transfer' | 'rebasing' | 'unknown'
    securityStatus: 'trusted' | 'low' | 'caution' | 'high' | 'blocked' | 'unknown'
}

export type PaymentTokenSelection = {
    candidate: PaymentTokenCandidate
    reason: 'stablecoin-owned' | 'eligible-sell-token' | 'eligible-buy-token'
}

export type CandidateRejection = {
    tokenAddress: string
    code: string
}

function relationshipRank(address: string, sellToken: string, buyToken: string) {
    if (address === sellToken) return 1
    if (buyToken !== NATIVE_TOKEN_ADDRESS && address === buyToken) return 2
    return 3
}

export function evaluatePaymentTokenCandidate({
    candidate,
    requiredPaymentRaw,
    now,
    configuredMinimumLiquidityUsdMicros,
}: {
    candidate: PaymentTokenCandidate
    requiredPaymentRaw: bigint
    now: Date
    configuredMinimumLiquidityUsdMicros: bigint
}): string | null {
    const address = normalizeAddress(candidate.tokenAddress)
    if (candidate.chainId !== 56) return 'WRONG_CHAIN'
    if (!address) return 'INVALID_PAYMENT_TOKEN'
    if (!candidate.enabled || !candidate.feePaymentEnabled) return 'PAYMENT_TOKEN_DISABLED'
    if (candidate.decimals !== candidate.onchainDecimals || candidate.decimals < 0 || candidate.decimals > 36) {
        return 'PAYMENT_TOKEN_DECIMALS_MISMATCH'
    }
    if (candidate.priceUsdMicros <= 0n) return 'PAYMENT_TOKEN_PRICE_UNAVAILABLE'
    const ageMilliseconds = now.getTime() - candidate.priceObservedAt.getTime()
    if (ageMilliseconds < 0 || ageMilliseconds > candidate.maximumPriceAgeSeconds * 1_000) {
        return 'PAYMENT_TOKEN_PRICE_STALE'
    }
    if (candidate.priceDeviationBps < 0 || candidate.priceDeviationBps > candidate.maximumPriceDeviationBps) {
        return 'PAYMENT_TOKEN_PRICE_DEVIATION'
    }
    if (candidate.securityStatus === 'unknown') return 'PAYMENT_TOKEN_MORALIS_UNAVAILABLE'
    if (candidate.securityStatus === 'blocked') return 'PAYMENT_TOKEN_SPAM_OR_BLOCKED'

    const minimumLiquidity = candidate.minimumLiquidityUsdMicros > configuredMinimumLiquidityUsdMicros
        ? candidate.minimumLiquidityUsdMicros
        : configuredMinimumLiquidityUsdMicros
    if (candidate.liquidityUsdMicros < minimumLiquidity) return 'PAYMENT_TOKEN_LIQUIDITY_LOW'

    if (!candidate.exactTransferRequired || candidate.feeOnTransferAllowed || candidate.transferBehavior === 'fee-on-transfer') {
        return 'FEE_ON_TRANSFER_UNSUPPORTED'
    }
    if (candidate.rebasingAllowed || candidate.transferBehavior === 'rebasing') {
        return 'REBASING_TOKEN_UNSUPPORTED'
    }

    const moralisSafetyConfirmed = ['trusted', 'low'].includes(candidate.securityStatus)
    if (candidate.strictSecurityRequired) {
        if (!moralisSafetyConfirmed) return 'PAYMENT_TOKEN_SECURITY_UNCONFIRMED'
        if (candidate.transferBehavior !== 'exact') return 'PAYMENT_TOKEN_TRANSFER_UNKNOWN'
    } else if (candidate.transferBehavior !== 'exact' && !moralisSafetyConfirmed) {
        return 'PAYMENT_TOKEN_TRANSFER_UNKNOWN'
    }

    if (candidate.balanceRaw < requiredPaymentRaw) return 'PAYMENT_TOKEN_BALANCE_LOW'
    return null
}

export function selectPaymentToken({
    candidates,
    requiredPaymentRawByToken,
    sellToken,
    buyToken,
    now,
    configuredMinimumLiquidityUsdMicros,
}: {
    candidates: PaymentTokenCandidate[]
    requiredPaymentRawByToken: Map<string, bigint>
    sellToken: string
    buyToken: string
    now: Date
    configuredMinimumLiquidityUsdMicros: bigint
}): { selection: PaymentTokenSelection | null; rejections: CandidateRejection[] } {
    const normalizedSell = normalizeAddress(sellToken)
    const normalizedBuy = buyToken === NATIVE_TOKEN_ADDRESS
        ? NATIVE_TOKEN_ADDRESS
        : normalizeAddress(buyToken)
    if (!normalizedSell || !normalizedBuy) {
        return { selection: null, rejections: [] }
    }

    const rejections: CandidateRejection[] = []
    const eligible = candidates.flatMap((candidate) => {
        const address = normalizeAddress(candidate.tokenAddress)
        if (!address) {
            rejections.push({ tokenAddress: candidate.tokenAddress, code: 'INVALID_PAYMENT_TOKEN' })
            return []
        }
        const requiredPaymentRaw = requiredPaymentRawByToken.get(address)
        if (requiredPaymentRaw === undefined) {
            rejections.push({ tokenAddress: address, code: 'PAYMENT_AMOUNT_UNAVAILABLE' })
            return []
        }
        const rejection = evaluatePaymentTokenCandidate({
            candidate,
            requiredPaymentRaw,
            now,
            configuredMinimumLiquidityUsdMicros,
        })
        if (rejection) {
            rejections.push({ tokenAddress: address, code: rejection })
            return []
        }
        return [{ ...candidate, tokenAddress: address }]
    })

    eligible.sort((left, right) => {
        if (left.isStablecoin !== right.isStablecoin) return left.isStablecoin ? -1 : 1
        const leftRelationship = relationshipRank(left.tokenAddress, normalizedSell, normalizedBuy)
        const rightRelationship = relationshipRank(right.tokenAddress, normalizedSell, normalizedBuy)
        if (leftRelationship !== rightRelationship) return leftRelationship - rightRelationship
        if (left.paymentPriority !== right.paymentPriority) return right.paymentPriority - left.paymentPriority
        if (left.liquidityUsdMicros !== right.liquidityUsdMicros) {
            return left.liquidityUsdMicros > right.liquidityUsdMicros ? -1 : 1
        }
        return left.tokenAddress.localeCompare(right.tokenAddress)
    })

    const candidate = eligible[0]
    if (!candidate) {
        if (process.env.DEBUG_SPONSORSHIP === 'true') {
            console.warn('[sponsorship-payment-token-selection-rejected]', {
                sellToken: normalizedSell,
                buyToken: normalizedBuy,
                configuredMinimumLiquidityUsdMicros: configuredMinimumLiquidityUsdMicros.toString(),
                requiredPaymentRawByToken: Object.fromEntries(
                    [...requiredPaymentRawByToken.entries()].map(([address, amount]) => [address, amount.toString()]),
                ),
                candidates: candidates.map((item) => ({
                    tokenAddress: item.tokenAddress,
                    symbol: item.symbol,
                    balanceRaw: item.balanceRaw.toString(),
                    priceUsdMicros: item.priceUsdMicros.toString(),
                    priceObservedAt: item.priceObservedAt.toISOString(),
                    priceDeviationBps: item.priceDeviationBps,
                    liquidityUsdMicros: item.liquidityUsdMicros.toString(),
                    transferBehavior: item.transferBehavior,
                    securityStatus: item.securityStatus,
                    strictSecurityRequired: item.strictSecurityRequired,
                })),
                rejections,
            })
        }
        return { selection: null, rejections }
    }
    return {
        selection: {
            candidate,
            reason: candidate.isStablecoin
                ? 'stablecoin-owned'
                : candidate.tokenAddress === normalizedSell
                    ? 'eligible-sell-token'
                    : 'eligible-buy-token',
        },
        rejections,
    }
}
