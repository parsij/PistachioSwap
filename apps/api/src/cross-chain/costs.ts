import { isRecord } from '../lib/http.js'
import type { CrossChainCosts } from './types.js'

type Decimal = {
    digits: bigint
    scale: number
}

export function emptyCrossChainCosts(
    confidence: CrossChainCosts['confidence'] = 'quote',
): CrossChainCosts {
    return {
        sourceGasUsd: null,
        sourceGasNative: null,
        destinationGasUsd: null,
        providerFeeUsd: null,
        appFeeUsd: null,
        swapImpactUsd: null,
        sponsoredUsd: null,
        routeCostUsd: null,
        totalEstimatedUsd: null,
        currency: 'USD',
        confidence,
    }
}

export function normalizeUsdDecimal(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null
    const match = String(value).trim().match(/^(\d+)(?:\.(\d+))?$/)
    if (!match) return null
    const whole = match[1].replace(/^0+(?=\d)/, '')
    const fraction = (match[2] ?? '').replace(/0+$/, '')
    return fraction ? `${whole}.${fraction}` : whole
}

export function addUsdDecimals(values: readonly (string | null)[]): string | null {
    const decimals = values
        .map(parseDecimal)
        .filter((value): value is Decimal => value !== null)
    if (!decimals.length) return null
    const scale = Math.max(...decimals.map((value) => value.scale))
    const total = decimals.reduce(
        (sum, value) => sum + value.digits * 10n ** BigInt(scale - value.scale),
        0n,
    )
    return formatDecimal({ digits: total, scale })
}

export function subtractUsdDecimal(
    totalValue: string | null,
    reductionValue: string | null,
): string | null {
    const total = parseDecimal(totalValue)
    if (!total) return null
    const reduction = parseDecimal(reductionValue)
    if (!reduction) return formatDecimal(total)
    const scale = Math.max(total.scale, reduction.scale)
    const totalDigits = total.digits * 10n ** BigInt(scale - total.scale)
    const reductionDigits = reduction.digits * 10n ** BigInt(scale - reduction.scale)
    return formatDecimal({
        digits: totalDigits > reductionDigits ? totalDigits - reductionDigits : 0n,
        scale,
    })
}

export function normalizePublicCosts(value: unknown): CrossChainCosts {
    const source = isRecord(value) ? value : {}
    const costs = emptyCrossChainCosts(
        source.confidence === 'prepared' || source.confidence === 'confirmed'
            ? source.confidence
            : 'quote',
    )
    return {
        ...costs,
        sourceGasUsd: normalizeUsdDecimal(source.sourceGasUsd),
        sourceGasNative: normalizeUsdDecimal(source.sourceGasNative),
        destinationGasUsd: normalizeUsdDecimal(source.destinationGasUsd),
        providerFeeUsd: normalizeUsdDecimal(source.providerFeeUsd),
        appFeeUsd: normalizeUsdDecimal(source.appFeeUsd),
        swapImpactUsd: normalizeUsdDecimal(source.swapImpactUsd),
        sponsoredUsd: normalizeUsdDecimal(source.sponsoredUsd),
        routeCostUsd: normalizeUsdDecimal(source.routeCostUsd),
        totalEstimatedUsd: normalizeUsdDecimal(source.totalEstimatedUsd),
    }
}

function parseDecimal(value: unknown): Decimal | null {
    const normalized = normalizeUsdDecimal(value)
    if (normalized === null) return null
    const [whole, fraction = ''] = normalized.split('.')
    return {
        digits: BigInt(`${whole}${fraction}`),
        scale: fraction.length,
    }
}

function formatDecimal(value: Decimal) {
    if (value.scale === 0) return value.digits.toString()
    const padded = value.digits.toString().padStart(value.scale + 1, '0')
    const whole = padded.slice(0, -value.scale)
    const fraction = padded.slice(-value.scale).replace(/0+$/, '')
    return fraction ? `${whole}.${fraction}` : whole
}
