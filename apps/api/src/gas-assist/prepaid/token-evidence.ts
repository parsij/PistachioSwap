import type { Address } from 'viem'

import { getTokenPrices } from '../../providers/alchemy/token-prices.js'
import {
    getHoneypotTokenSecurity,
    unavailableHoneypotSecurity,
} from '../../providers/security/honeypot-token-security.js'
import type { HoneypotTokenSecurity, SecurityStatus } from '../../providers/security/types.js'
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

function maximum(values: Array<bigint | null>) {
    return values.reduce<bigint>((result, value) => value !== null && value > result ? value : result, 0n)
}

function deviationBps(primary: bigint, reference: bigint | null) {
    if (primary <= 0n || reference === null || reference <= 0n) return null
    const difference = primary > reference ? primary - reference : reference - primary
    return Number(ceilDiv(difference * 10_000n, primary))
}

function optionalReferenceDeviationBps(primary: bigint | null, reference: bigint | null) {
    if (primary === null || primary <= 0n) return null
    return reference === null || reference <= 0n
        ? 0
        : deviationBps(primary, reference)
}

function isZeroDecimal(value: string | null) {
    const parsed = optionalMicros(value)
    return parsed === 0n
}

function hasExactTransferEvidence(honeypot: HoneypotTokenSecurity) {
    return honeypot.available &&
        honeypot.simulationSuccess === true &&
        isZeroDecimal(honeypot.transferTaxPercent) &&
        isZeroDecimal(honeypot.sellTaxPercent)
}

function classifyMoralisSecurity(evidence: MoralisSponsorshipTokenEvidence): SecurityStatus {
    if (!evidence.available) return 'unknown'
    if (evidence.possibleSpam === true) return 'blocked'

    const score = evidence.securityScore
    if (score !== null && score < 20) return 'blocked'
    if (score !== null && score < 50) return 'high'
    if (score !== null && score < 70) return 'caution'
    if (evidence.verifiedContract === false) return 'caution'
    if (score !== null && score >= 80 && evidence.verifiedContract === true) return 'trusted'
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
        message: 'Refreshed sponsorship token security, liquidity, transfer-behavior, price-age, and price-deviation gates were bypassed.',
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
    const [prices, honeypot, moralis] = await Promise.all([
        getTokenPrices({ addresses: [address] }),
        getHoneypotTokenSecurity(address).catch(() => unavailableHoneypotSecurity(address)),
        getMoralisSponsorshipTokenEvidence(address),
    ])

    const price = prices.get(address.toLowerCase())
    const priceUsdMicros = optionalMicros(price)
    const moralisPriceUsdMicros = optionalMicros(moralis.priceUsd)
    const liquidityUsdMicros = maximum([
        optionalMicros(honeypot.liquidityUsd),
        optionalMicros(moralis.liquidityUsd),
    ])

    return applyDangerousBypass({
        priceUsdMicros,
        priceObservedAt: observedAt,
        priceDeviationBps: optionalReferenceDeviationBps(
            priceUsdMicros,
            moralisPriceUsdMicros,
        ),
        liquidityUsdMicros,
        securityStatus: classifyMoralisSecurity(moralis),
        transferBehavior: hasExactTransferEvidence(honeypot)
            ? 'exact' as const
            : 'unknown' as const,
        moralisAvailable: moralis.available,
        moralisSecurityScore: moralis.securityScore,
        moralisPossibleSpam: moralis.possibleSpam,
        moralisVerifiedContract: moralis.verifiedContract,
    })
}

export const tokenEvidenceInternals = {
    optionalMicros,
    deviationBps,
    optionalReferenceDeviationBps,
    hasExactTransferEvidence,
    classifyMoralisSecurity,
    dangerouslyBypassSponsorshipTokenChecks,
    applyDangerousBypass,
}
