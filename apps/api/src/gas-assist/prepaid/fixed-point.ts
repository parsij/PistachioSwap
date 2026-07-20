export const USD_MICROS = 1_000_000n
export const BPS_DENOMINATOR = 10_000n

export function ceilDiv(numerator: bigint, denominator: bigint) {
    if (numerator < 0n || denominator <= 0n) {
        throw new Error('Ceiling division requires a nonnegative numerator and positive denominator.')
    }
    return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator
}

export function parseFixed(value: string, scale = 6) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
        throw new Error('Fixed-point value must be a nonnegative decimal string.')
    }
    const [whole, fraction = ''] = value.split('.')
    if (fraction.length > scale) {
        throw new Error(`Fixed-point value has more than ${scale} decimal places.`)
    }
    return BigInt(whole) * 10n ** BigInt(scale) +
        BigInt(fraction.padEnd(scale, '0') || '0')
}

export function formatFixed(value: bigint, scale = 6) {
    if (value < 0n) throw new Error('Fixed-point value cannot be negative.')
    const base = 10n ** BigInt(scale)
    const whole = value / base
    const fraction = (value % base)
        .toString()
        .padStart(scale, '0')
        .replace(/0+$/, '')
    return fraction ? `${whole}.${fraction}` : whole.toString()
}

export type BillingMode =
    | 'provider-integrator'
    | 'prepaid-megafuel'
    | 'normal-provider-fee'

export type SponsoredFlow =
    | 'zero-x-gasless-direct'
    | 'zero-x-gasless-after-approval'
    | 'normal-sponsored-swap'

export type PrepaymentCalculation = {
    fixedServiceFeeUsdMicros: bigint
    platformFeeUsdMicros: bigint
    commercialFeeUsdMicros: bigint
    estimatedSponsoredGasUsdMicros: bigint
    gasReserveUsdMicros: bigint
    conversionCostUsdMicros: bigint
    totalPrepaymentUsdMicros: bigint
}

export function calculatePrepayment({
    tradeNotionalUsdMicros,
    paymentTransferGasUsdMicros,
    approvalGasUsdMicros,
    normalSwapGasUsdMicros,
    conversionCostUsdMicros = 0n,
    flow,
    gasMultiplierBps,
    fixedFeeUsdMicros,
    platformFeeBps,
    commercialFeeCapUsdMicros,
    billingMode = 'prepaid-megafuel',
    providerIntegratorFeeBps = 0,
}: {
    tradeNotionalUsdMicros: bigint
    paymentTransferGasUsdMicros: bigint
    approvalGasUsdMicros: bigint
    normalSwapGasUsdMicros: bigint
    conversionCostUsdMicros?: bigint
    flow: SponsoredFlow
    gasMultiplierBps: number
    fixedFeeUsdMicros: bigint
    platformFeeBps: number
    commercialFeeCapUsdMicros: bigint
    billingMode?: BillingMode
    providerIntegratorFeeBps?: number
}): PrepaymentCalculation {
    const integerInputs = [
        tradeNotionalUsdMicros,
        paymentTransferGasUsdMicros,
        approvalGasUsdMicros,
        normalSwapGasUsdMicros,
        conversionCostUsdMicros,
        fixedFeeUsdMicros,
        commercialFeeCapUsdMicros,
    ]
    if (integerInputs.some((value) => value < 0n)) {
        throw new Error('Prepayment inputs cannot be negative.')
    }
    if (!Number.isInteger(gasMultiplierBps) || gasMultiplierBps < 10_000) {
        throw new Error('Gas multiplier must be an integer at or above 10000 BPS.')
    }
    if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10_000) {
        throw new Error('Platform fee must be an integer between 0 and 10000 BPS.')
    }
    if (billingMode !== 'prepaid-megafuel' || providerIntegratorFeeBps !== 0) {
        throw new Error('Prepaid MegaFuel billing cannot coexist with a provider integrator fee.')
    }
    if (flow === 'zero-x-gasless-direct') {
        throw new Error('A direct 0x Gasless route must not create a prepaid order.')
    }
    if (flow === 'zero-x-gasless-after-approval' && normalSwapGasUsdMicros !== 0n) {
        throw new Error('0x Gasless final swaps must not be included in MegaFuel gas.')
    }

    const estimatedSponsoredGasUsdMicros =
        paymentTransferGasUsdMicros + approvalGasUsdMicros + normalSwapGasUsdMicros
    const gasReserveUsdMicros = ceilDiv(
        estimatedSponsoredGasUsdMicros * BigInt(gasMultiplierBps),
        BPS_DENOMINATOR,
    )
    const platformFeeUsdMicros = ceilDiv(
        tradeNotionalUsdMicros * BigInt(platformFeeBps),
        BPS_DENOMINATOR,
    )
    const uncappedCommercialFee = fixedFeeUsdMicros + platformFeeUsdMicros
    const commercialFeeUsdMicros = uncappedCommercialFee < commercialFeeCapUsdMicros
        ? uncappedCommercialFee
        : commercialFeeCapUsdMicros

    return {
        fixedServiceFeeUsdMicros: fixedFeeUsdMicros,
        platformFeeUsdMicros:
            commercialFeeUsdMicros > fixedFeeUsdMicros
                ? commercialFeeUsdMicros - fixedFeeUsdMicros
                : 0n,
        commercialFeeUsdMicros,
        estimatedSponsoredGasUsdMicros,
        gasReserveUsdMicros,
        conversionCostUsdMicros,
        totalPrepaymentUsdMicros:
            commercialFeeUsdMicros + gasReserveUsdMicros + conversionCostUsdMicros,
    }
}

export function usdMicrosToTokenRawCeil({
    usdMicros,
    tokenPriceUsdMicros,
    tokenDecimals,
}: {
    usdMicros: bigint
    tokenPriceUsdMicros: bigint
    tokenDecimals: number
}) {
    if (usdMicros < 0n || tokenPriceUsdMicros <= 0n) {
        throw new Error('USD amount and token price are invalid.')
    }
    if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 36) {
        throw new Error('Token decimals are outside the supported range.')
    }
    return ceilDiv(
        usdMicros * 10n ** BigInt(tokenDecimals),
        tokenPriceUsdMicros,
    )
}

export function tokenRawToUsdMicrosFloor({
    amountRaw,
    tokenPriceUsdMicros,
    tokenDecimals,
}: {
    amountRaw: bigint
    tokenPriceUsdMicros: bigint
    tokenDecimals: number
}) {
    if (amountRaw < 0n || tokenPriceUsdMicros <= 0n) {
        throw new Error('Token amount and price are invalid.')
    }
    return amountRaw * tokenPriceUsdMicros / 10n ** BigInt(tokenDecimals)
}
