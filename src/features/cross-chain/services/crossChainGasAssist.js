const USD_SCALE = 1_000_000n
const BPS_SCALE = 10_000n
const GAS_HEADROOM_BPS = 15_000n
const MINIMUM_PREVIEW_HEADROOM_BPS = 12_500n
const SPONSORSHIP_OVERHEAD_USD_MICROS = 100_000n

function decimalMicros(value) {
    const normalized = String(value ?? '').trim()
    if (!/^\d+(?:\.\d+)?$/u.test(normalized)) return null
    const [whole, fraction = ''] = normalized.split('.')
    if (fraction.length > 6) return null
    return BigInt(whole) * USD_SCALE + BigInt(fraction.padEnd(6, '0') || '0')
}

function ceilDiv(numerator, denominator) {
    if (denominator <= 0n) return null
    return (numerator + denominator - 1n) / denominator
}

/**
 * Estimates a conservative sell-token slice for a sponsored BNB top-up.
 * The backend remains authoritative and rechecks the whitelist, balance,
 * token evidence, exact fees, and economic limits before creating an order.
 */
export function estimateCrossChainGasAssistInput({
    totalInputRaw,
    tokenDecimals,
    tokenPriceUsd,
    sourceGasUsd,
    requiredNativeGasWei,
    nativeBalanceWei,
    fixedFeeUsd,
    platformFeeBps,
}) {
    try {
        const total = BigInt(totalInputRaw)
        const decimals = Number(tokenDecimals)
        const requiredGas = BigInt(requiredNativeGasWei)
        const nativeBalance = BigInt(nativeBalanceWei ?? 0)
        const tokenPrice = decimalMicros(tokenPriceUsd)
        const totalGasUsd = decimalMicros(sourceGasUsd)
        const fixedFee = decimalMicros(fixedFeeUsd)
        const feeBps = BigInt(platformFeeBps)
        if (
            total <= 1n || !Number.isInteger(decimals) || decimals < 0 || decimals > 255 ||
            requiredGas <= nativeBalance || !tokenPrice || tokenPrice <= 0n ||
            !totalGasUsd || totalGasUsd <= 0n || fixedFee === null ||
            feeBps < 0n || feeBps >= BPS_SCALE
        ) return null

        const shortfall = requiredGas - nativeBalance
        const shortfallUsd = ceilDiv(totalGasUsd * shortfall, requiredGas)
        const targetOutputUsd = shortfallUsd === null
            ? null
            : ceilDiv(shortfallUsd * GAS_HEADROOM_BPS, BPS_SCALE)
        const grossUsd = targetOutputUsd === null
            ? null
            : ceilDiv(
                (targetOutputUsd + fixedFee + SPONSORSHIP_OVERHEAD_USD_MICROS) * BPS_SCALE,
                BPS_SCALE - feeBps,
            )
        const raw = grossUsd === null
            ? null
            : ceilDiv(grossUsd * (10n ** BigInt(decimals)), tokenPrice)
        if (raw === null || raw <= 0n || raw >= total) return null
        return raw.toString()
    } catch {
        return null
    }
}

export function previewCoversNativeGas({ preview, requiredNativeGasWei, nativeBalanceWei }) {
    try {
        const shortfall = BigInt(requiredNativeGasWei) - BigInt(nativeBalanceWei ?? 0)
        const requiredTopUp = ceilDiv(shortfall * MINIMUM_PREVIEW_HEADROOM_BPS, BPS_SCALE)
        return shortfall > 0n && requiredTopUp !== null &&
            BigInt(preview?.minimumOutputRaw ?? 0) >= requiredTopUp
    } catch {
        return false
    }
}
