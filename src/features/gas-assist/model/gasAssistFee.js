const RAW_AMOUNT = /^\d+$/u
const USD_AMOUNT = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u

function rawAmount(value) {
    const normalized = String(value ?? '')
    return RAW_AMOUNT.test(normalized) ? BigInt(normalized) : null
}

export function usdDecimalToMicros(value) {
    const normalized = String(value ?? '').trim()
    if (!USD_AMOUNT.test(normalized)) return null
    const [whole, fraction = ''] = normalized.split('.')
    if (fraction.length > 6) return null
    return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0') || '0')
}

function usdMicros(order, directKey, decimalKey) {
    const direct = rawAmount(order?.[directKey])
    return direct ?? usdDecimalToMicros(order?.amountsUsd?.[decimalKey])
}

/**
 * Validates the economic identity shared by same-chain and cross-chain Gas Assist.
 * The exact sell-token fee and net router input must add up to the amount the user entered.
 */
export function getGasAssistFeeBreakdown(order) {
    const grossInputRaw = rawAmount(order?.grossInputAmountRaw)
    const netSwapInputRaw = rawAmount(order?.netSwapAmountRaw)
    const totalFeeRaw = rawAmount(order?.paymentAmountRaw)
    const expectedOutputRaw = rawAmount(order?.expectedOutputRaw)
    const minimumOutputRaw = rawAmount(order?.minimumOutputRaw)

    if (
        grossInputRaw === null || grossInputRaw <= 0n ||
        netSwapInputRaw === null || netSwapInputRaw <= 0n ||
        totalFeeRaw === null || totalFeeRaw <= 0n ||
        totalFeeRaw >= grossInputRaw ||
        netSwapInputRaw + totalFeeRaw !== grossInputRaw ||
        expectedOutputRaw === null || expectedOutputRaw <= 0n ||
        minimumOutputRaw === null || minimumOutputRaw <= 0n ||
        minimumOutputRaw > expectedOutputRaw
    ) return null

    const tradeNotionalUsdMicros = usdMicros(
        order,
        'tradeNotionalUsdMicros',
        'tradeNotional',
    )
    const totalFeeUsdMicros = usdMicros(
        order,
        'totalPrepaymentUsdMicros',
        'totalPrepayment',
    )
    const commercialFeeUsdMicros = usdMicros(
        order,
        'commercialFeeUsdMicros',
        'commercialFee',
    )
    const networkReserveUsdMicros = usdMicros(
        order,
        'gasReserveUsdMicros',
        'gasReserve',
    )
    const estimatedSponsoredGasUsdMicros = usdMicros(
        order,
        'estimatedSponsoredGasUsdMicros',
        'estimatedSponsoredGas',
    )
    const routeCostUsdMicros = usdMicros(
        order,
        'routeCostUsdMicros',
        'routeCost',
    ) ?? usdDecimalToMicros(order?.providerFees?.routeCostUsd)
    const disclosedAllInCostUsdMicros = usdMicros(
        order,
        'allInCostUsdMicros',
        'allInCost',
    ) ?? usdDecimalToMicros(order?.providerFees?.allInCostUsd)
    const allInCostUsdMicros = disclosedAllInCostUsdMicros ?? (
        totalFeeUsdMicros === null
            ? null
            : totalFeeUsdMicros + (routeCostUsdMicros ?? 0n)
    )

    if (
        totalFeeUsdMicros === null || totalFeeUsdMicros <= 0n ||
        tradeNotionalUsdMicros !== null && totalFeeUsdMicros >= tradeNotionalUsdMicros ||
        allInCostUsdMicros !== null && (
            allInCostUsdMicros < totalFeeUsdMicros ||
            tradeNotionalUsdMicros !== null && allInCostUsdMicros >= tradeNotionalUsdMicros
        )
    ) return null

    return {
        grossInputRaw,
        netSwapInputRaw,
        totalFeeRaw,
        expectedOutputRaw,
        minimumOutputRaw,
        tradeNotionalUsdMicros,
        totalFeeUsdMicros,
        commercialFeeUsdMicros,
        networkReserveUsdMicros,
        estimatedSponsoredGasUsdMicros,
        routeCostUsdMicros,
        allInCostUsdMicros,
    }
}

export function requireGasAssistFeeBreakdown(order, {
    code = 'SPONSORSHIP_PREVIEW_INVALID_RESPONSE',
    message = 'Gas Assist returned inconsistent fee or quote amounts.',
} = {}) {
    const breakdown = getGasAssistFeeBreakdown(order)
    if (breakdown) return breakdown

    const error = new Error(message)
    error.code = code
    throw error
}
