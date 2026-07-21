import type { Address } from 'viem'

import { getTokenPrices } from '../../providers/alchemy/token-prices.js'
import { fetchTokenMarkets } from '../../providers/dexscreener/token-markets.js'
import type { SecurityStatus } from '../../providers/security/types.js'
import {
    getMoralisSponsorshipTokenEvidence,
    type MoralisSponsorshipTokenEvidence,
} from '../../providers/moralis/sponsorship-token-evidence.js'
import { ceilDiv, parseFixed } from './fixed-point.js'

const BYPASS_LIQUIDITY_USD_MICROS = 10n ** 30n

function dangerouslyBypassSponsorshipTokenChecks() {
    return process.env.DANGEROUSLY_BYPASS_SPONSORSHIP_TOKEN_CHECKS
        ?.trim()
        .toLowerCase() === 'true'
}

function optionalMicros(value: string | null | undefined) {
    if (!value || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null
    try {
        return parseFixed(value)
    } catch {
        return null
    }
}

function numericMicros(value: number | null | undefined) {
    if (value === null || value === undefined ||
        !Number.isFinite(value) || value < 0) return null
    return optionalMicros(value.toFixed(6))
}

function maximum(values: Array<bigint | null>) {
    return values.reduce<bigint>(
        (result, value) => value !== null && value > result ? value : result,
        0n,
    )
}

function deviationBps(primary: bigint, reference: bigint | null) {
    if (primary <= 0n || reference === null || reference <= 0n) return null
    const difference = primary > reference
        ? primary - reference
        : reference - primary
    return Number(ceilDiv(difference * 10_000n, primary))
}

function optionalReferenceDeviationBps(
    primary: bigint | null,
    reference: bigint | null,
) {
    if (primary === null || primary <= 0n) return null
    return reference === null || reference <= 0n
        ? 0
        : deviationBps(primary, reference)
}

function classifyMoralisSecurity(
    evidence: MoralisSponsorshipTokenEvidence,
): SecurityStatus {
    if (!evidence.available) return 'unknown'
    if (evidence.possibleSpam === true) return 'blocked'

    const score = evidence.securityScore
    if (score !== null && score < 20) return 'blocked'
    if (score !== null && score < 50) return 'high'
    if (score !== null && score < 70) return 'caution'
    if (evidence.verifiedContract === false) return 'caution'
    if (score !== null && score >= 80 &&
        evidence.verifiedContract === true) return 'trusted'
    if (score !== null && score >= 70) return 'low'
    if (evidence.verifiedContract === true) return 'low'
    return 'unknown'
}

function applyDangerousBypass<T extends {
    priceUsdMicros: bigint | null
    priceDeviationBps: number | null
    liquidityUsdMicros: bigint
    securityStatus: SecurityStatus
    transferBehavior: 'exact' | 'unknown'
}>(evidence: T): T & { dangerousBypassApplied: boolean } {
    if (!dangerouslyBypassSponsorshipTokenChecks()) {
        return { ...evidence, dangerousBypassApplied: false }
    }

    console.warn('[DANGEROUSLY_BYPASS_SPONSORSHIP_TOKEN_CHECKS]', {
        enabled: true,
        stage: 'token-evidence-refresh',
        message: 'Price-age, price-deviation, and liquidity gates were bypassed for a database-whitelisted sponsorship token.',
    })

    return {
        ...evidence,
        priceDeviationBps: evidence.priceUsdMicros === null ? null : 0,
        liquidityUsdMicros: BYPASS_LIQUIDITY_USD_MICROS,
        securityStatus: 'trusted',
        transferBehavior: 'exact',
        dangerousBypassApplied: true,
    }
}

export async function getSponsorshipTokenEvidence(address: Address) {
    const observedAt = new Date()
    const [prices, moralis, dexMarkets] = await Promise.all([
        getTokenPrices({ addresses: [address] }),
        getMoralisSponsorshipTokenEvidence(address),
        fetchTokenMarkets([address]).catch(() => ({
            markets: new Map(),
            partial: true,
            successfulBatches: 0,
            failedBatches: 1,
        })),
    ])

    const price = prices.get(address.toLowerCase())
    const priceUsdMicros = optionalMicros(price)
    const moralisPriceUsdMicros = optionalMicros(moralis.priceUsd)
    const dexMarket = dexMarkets.markets.get(address.toLowerCase())
    const liquidityUsdMicros = maximum([
        optionalMicros(moralis.liquidityUsd),
        numericMicros(dexMarket?.liquidityUsd),
    ])

    return applyDangerousBypass({
        priceUsdMicros,
        priceObservedAt: observedAt,
        priceDeviationBps: optionalReferenceDeviationBps(
            priceUsdMicros,
            moralisPriceUsdMicros,
        ),
        liquidityUsdMicros,
        // Enabling the exact address in sponsorship_payment_tokens is the
        // security trust decision. External scanners remain diagnostics only.
        securityStatus: 'trusted' as const,
        transferBehavior: 'exact' as const,
        whitelistTrustApplied: true,
        moralisAvailable: moralis.available,
        moralisSecurityStatus: classifyMoralisSecurity(moralis),
        moralisSecurityScore: moralis.securityScore,
        moralisPossibleSpam: moralis.possibleSpam,
        moralisVerifiedContract: moralis.verifiedContract,
        moralisLiquidityUsdMicros: optionalMicros(moralis.liquidityUsd),
        dexScreenerLiquidityUsdMicros: numericMicros(dexMarket?.liquidityUsd),
        liquiditySource: dexMarket &&
            numericMicros(dexMarket.liquidityUsd) === liquidityUsdMicros
            ? 'dexscreener'
            : moralis.liquidityUsd
                ? 'moralis'
                : 'unavailable',
    })
}

export const tokenEvidenceInternals = {
    optionalMicros,
    numericMicros,
    deviationBps,
    optionalReferenceDeviationBps,
    classifyMoralisSecurity,
    dangerouslyBypassSponsorshipTokenChecks,
    applyDangerousBypass,
}
