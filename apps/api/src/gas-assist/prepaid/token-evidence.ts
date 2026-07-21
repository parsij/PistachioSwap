import type { Address } from 'viem'

import { getTokenPrices } from '../../providers/alchemy/token-prices.js'
import { getCoinGeckoToken } from '../../providers/coingecko/token-data.js'
import { tokenSecurityService } from '../../providers/security/token-security.js'
import type {
    GoPlusTokenSecurity,
    HoneypotTokenSecurity,
} from '../../providers/security/types.js'
import { ceilDiv, parseFixed } from './fixed-point.js'

function optionalMicros(value: string | null | undefined) {
    if (!value || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null
    try {
        return parseFixed(value)
    } catch {
        return null
    }
}

function maximum(values: Array<bigint | null>) {
    return values.reduce<bigint>((result, value) => value !== null && value > result ? value : result, 0n)
}

function deviationBps(primary: bigint, reference: bigint | null) {
    if (primary <= 0n || reference === null || reference <= 0n) return null
    const difference = primary > reference ? primary - reference : reference - primary
    return Number(ceilDiv(difference * 10_000n, primary))
}

function isZeroDecimal(value: string | null) {
    const parsed = optionalMicros(value)
    return parsed === 0n
}

function hasExactTransferEvidence({
    honeypot,
    goPlus,
}: {
    honeypot: HoneypotTokenSecurity
    goPlus: GoPlusTokenSecurity
}) {
    const honeypotConfirmsExactTransfer =
        honeypot.available &&
        honeypot.simulationSuccess === true &&
        isZeroDecimal(honeypot.transferTaxPercent) &&
        isZeroDecimal(honeypot.sellTaxPercent)

    if (!honeypotConfirmsExactTransfer) return false

    // Honeypot.is supplies an actual transfer/sell simulation. When GoPlus is
    // disabled or temporarily unavailable, that successful zero-tax simulation
    // is sufficient for a manually enabled payment token. If GoPlus is present,
    // it must not contradict the simulation with mutable-tax or balance controls.
    if (!goPlus.available) return true

    return isZeroDecimal(goPlus.transferTaxFraction) &&
        goPlus.ownerCanChangeBalance === false &&
        goPlus.taxModifiable === false
}

export async function getSponsorshipTokenEvidence(address: Address) {
    const observedAt = new Date()
    const [prices, coinGecko, security] = await Promise.all([
        getTokenPrices({ addresses: [address] }),
        getCoinGeckoToken(address),
        tokenSecurityService.refresh(address),
    ])
    const price = prices.get(address.toLowerCase())
    const priceUsdMicros = optionalMicros(price)
    const marketPriceUsdMicros = optionalMicros(coinGecko?.priceUSD)
    const liquidityUsdMicros = maximum([
        optionalMicros(security.honeypot.liquidityUsd),
        optionalMicros(security.goPlus.dexLiquidityUsd),
    ])
    const exactTransferKnown = hasExactTransferEvidence({
        honeypot: security.honeypot,
        goPlus: security.goPlus,
    })

    return {
        priceUsdMicros,
        priceObservedAt: observedAt,
        priceDeviationBps: priceUsdMicros === null
            ? null
            : deviationBps(priceUsdMicros, marketPriceUsdMicros),
        liquidityUsdMicros,
        securityStatus: security.securityStatus,
        transferBehavior: exactTransferKnown ? 'exact' as const : 'unknown' as const,
    }
}

export const tokenEvidenceInternals = {
    optionalMicros,
    deviationBps,
    hasExactTransferEvidence,
}
