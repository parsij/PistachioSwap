import { getApiConfig } from '../../config.js'
import { normalizeAddress } from '../../lib/address.js'
import { setBoundedCacheEntry } from '../../lib/bounded-cache.js'
import {
    getGoPlusTokenSecurity,
    unavailableGoPlusSecurity,
} from './goplus-token-security.js'
import {
    getHoneypotTokenSecurity,
    unavailableHoneypotSecurity,
} from './honeypot-token-security.js'
import type {
    GoPlusTokenSecurity,
    HoneypotFlag,
    HoneypotTokenSecurity,
    SecurityStatus,
    TokenSecurityAssessment,
} from './types.js'
import { requireActiveTokenDiscoveryChain } from '../../token-discovery/registry.js'

type CacheEntry = {
    assessment: TokenSecurityAssessment
    expiresAt: number
    refreshAfter: number
    conclusive: boolean
}

type SecurityDependencies = {
    getHoneypot: typeof getHoneypotTokenSecurity
    getGoPlus: typeof getGoPlusTokenSecurity
    now: () => number
}

type AssessmentListener = (
    address: string,
    assessment: TokenSecurityAssessment,
    previous: TokenSecurityAssessment | null,
) => void

const cache = new Map<string, CacheEntry>()
const pending = new Map<string, Promise<TokenSecurityAssessment>>()
const assessmentListeners = new Set<AssessmentListener>()

function materiallyChanged(
    previous: TokenSecurityAssessment | null,
    assessment: TokenSecurityAssessment,
) {
    if (!previous) return true
    return previous.securityStatus !== assessment.securityStatus ||
        previous.securityScore !== assessment.securityScore ||
        previous.securityReasons.join('|') !== assessment.securityReasons.join('|')
}

function notifyAssessmentListeners(
    address: string,
    assessment: TokenSecurityAssessment,
    previous: TokenSecurityAssessment | null,
) {
    if (!materiallyChanged(previous, assessment)) return
    for (const listener of assessmentListeners) {
        try {
            listener(address, assessment, previous)
        } catch {
            // Cache invalidation listeners must not affect provider results.
        }
    }
}

function hasFlag(flags: HoneypotFlag[], pattern: RegExp, severities?: RegExp) {
    return flags.some((flag) =>
        pattern.test(`${flag.code} ${flag.description ?? ''}`) &&
        (!severities || severities.test(flag.severity ?? '')),
    )
}

function percentAtLeast(value: string | null, threshold: number) {
    return value !== null && Number.isFinite(Number(value)) && Number(value) >= threshold
}

function fractionAtLeast(value: string | null, threshold: number) {
    if (value === null || !Number.isFinite(Number(value))) return false
    const parsed = Number(value)
    return parsed >= threshold || parsed * 100 >= threshold
}

function unique(values: string[]) {
    return [...new Set(values)]
}

export function classifyTokenSecurity({
    honeypot,
    goPlus,
}: {
    honeypot: HoneypotTokenSecurity
    goPlus: GoPlusTokenSecurity
}): Pick<TokenSecurityAssessment, 'securityStatus' | 'securityScore' | 'securityReasons'> {
    const reasons: string[] = []
    const sellFailureFlag = hasFlag(
        honeypot.flags,
        /sell.*(fail|block|impossible|restrict)|(fail|block|impossible|restrict).*sell/i,
    )
    const transferWarningFlag = hasFlag(
        honeypot.flags,
        /transfer.*(fail|block|impossible|restrict)|(fail|block|impossible|restrict).*transfer/i,
    )
    const mediumTransferWarning = hasFlag(
        honeypot.flags,
        /transfer.*(fail|block|impossible|restrict)|(fail|block|impossible|restrict).*transfer/i,
        /medium/i,
    )
    const observedTransferFailures = {
        sellSimulationFailed:
            honeypot.simulationSuccess === false && sellFailureFlag,
        transferSimulationFailed:
            honeypot.simulationSuccess === false && transferWarningFlag,
    }
    const transferControlCapabilities = {
        pausable: goPlus.transferPausable === true,
        blacklistCapable: goPlus.hasBlacklist === true ||
            hasFlag(honeypot.flags, /blacklist/i),
        whitelistCapable: goPlus.hasWhitelist === true ||
            hasFlag(honeypot.flags, /whitelist/i),
        issuerFreezeCapable: hasFlag(
            honeypot.flags,
            /issuer.*freeze|freeze.*(address|holder|account|capab)/i,
        ),
        providerTransferWarning:
            transferWarningFlag && !observedTransferFailures.transferSimulationFailed,
    }
    const sellTaxBlocked = percentAtLeast(honeypot.sellTaxPercent, 99.5) ||
        fractionAtLeast(goPlus.sellTaxFraction, 99.5)
    const transferTaxBlocked = percentAtLeast(honeypot.transferTaxPercent, 99.5) ||
        fractionAtLeast(goPlus.transferTaxFraction, 99.5)
    const blocked = honeypot.isHoneypot === true ||
        honeypot.risk === 'honeypot' ||
        (honeypot.riskLevel !== null && honeypot.riskLevel >= 90) ||
        goPlus.isHoneypot === true ||
        observedTransferFailures.sellSimulationFailed ||
        observedTransferFailures.transferSimulationFailed ||
        sellTaxBlocked || transferTaxBlocked

    if (honeypot.isHoneypot === true || honeypot.risk === 'honeypot' || goPlus.isHoneypot === true) {
        reasons.push('honeypot-confirmed')
    }
    if (honeypot.riskLevel !== null && honeypot.riskLevel >= 90) reasons.push('honeypot-risk-high')
    if (observedTransferFailures.sellSimulationFailed) reasons.push('sell-simulation-failed')
    if (observedTransferFailures.transferSimulationFailed) reasons.push('transfer-simulation-failed')
    if (sellTaxBlocked) reasons.push('high-sell-tax')
    if (transferTaxBlocked) reasons.push('high-transfer-tax')
    if (goPlus.ownerCanChangeBalance === true) reasons.push('owner-can-change-balance')
    if (blocked) {
        return {
            securityStatus: 'blocked',
            securityScore: honeypot.riskLevel,
            securityReasons: unique(reasons),
        }
    }

    const high = (honeypot.riskLevel !== null && honeypot.riskLevel >= 60) ||
        ['high', 'very_high'].includes(honeypot.risk) ||
        (honeypot.holderFailureCount ?? 0) >= 3 ||
        (honeypot.holderSiphonedCount ?? 0) >= 1 ||
        percentAtLeast(honeypot.sellTaxPercent, 50) ||
        percentAtLeast(honeypot.transferTaxPercent, 50) ||
        goPlus.cannotSellAll === true ||
        goPlus.personalTaxModifiable === true ||
        goPlus.ownerCanChangeBalance === true ||
        goPlus.hiddenOwner === true ||
        fractionAtLeast(goPlus.sellTaxFraction, 50) ||
        fractionAtLeast(goPlus.transferTaxFraction, 50)
    if (high) {
        if (percentAtLeast(honeypot.sellTaxPercent, 50) || fractionAtLeast(goPlus.sellTaxFraction, 50)) {
            reasons.push('high-sell-tax')
        }
        if (percentAtLeast(honeypot.transferTaxPercent, 50) || fractionAtLeast(goPlus.transferTaxFraction, 50)) {
            reasons.push('high-transfer-tax')
        }
        if (goPlus.cannotSellAll === true) reasons.push('cannot-sell-all')
        if (goPlus.ownerCanChangeBalance === true) reasons.push('owner-can-change-balance')
        reasons.push('security-risk-high')
        return {
            securityStatus: 'high',
            securityScore: honeypot.riskLevel,
            securityReasons: unique(reasons),
        }
    }

    const providerDisagreement = honeypot.available && goPlus.available &&
        ((honeypot.risk === 'low' || honeypot.risk === 'very_low') &&
            [
                goPlus.hasBlacklist,
                goPlus.hasWhitelist,
                goPlus.transferPausable,
                goPlus.taxModifiable,
            ].includes(true))
    const optionalProviderUnavailable = honeypot.available !== goPlus.available
    const moderateTax = [
        honeypot.buyTaxPercent,
        honeypot.sellTaxPercent,
        honeypot.transferTaxPercent,
    ].some((value) => percentAtLeast(value, 0.01) && !percentAtLeast(value, 50)) || [
        goPlus.buyTaxFraction,
        goPlus.sellTaxFraction,
        goPlus.transferTaxFraction,
    ].some((value) => fractionAtLeast(value, 0.01) && !fractionAtLeast(value, 50))
    const low = (honeypot.riskLevel !== null && honeypot.riskLevel >= 0 && honeypot.riskLevel < 20) ||
        honeypot.risk === 'very_low' || honeypot.risk === 'low'
    const caution = (honeypot.riskLevel !== null && honeypot.riskLevel >= 20) ||
        honeypot.risk === 'medium' ||
        honeypot.contractOpenSource === false ||
        honeypot.rootContractOpenSource === false ||
        honeypot.isProxy === true ||
        Object.values(transferControlCapabilities).includes(true) ||
        goPlus.taxModifiable === true || providerDisagreement ||
        moderateTax || optionalProviderUnavailable ||
        (!low && honeypot.holderFailureCount === null && honeypot.available)
    if (caution) {
        if (Object.values(transferControlCapabilities).includes(true)) {
            reasons.push('transfer-control-capability')
        }
        if (transferControlCapabilities.blacklistCapable) reasons.push('blacklist-capability')
        if (transferControlCapabilities.whitelistCapable) reasons.push('whitelist-capability')
        if (transferControlCapabilities.issuerFreezeCapable) reasons.push('issuer-freeze-capability')
        if (transferControlCapabilities.pausable) reasons.push('transfer-pausable')
        if (mediumTransferWarning) reasons.push('provider-medium-transfer-warning')
        if (goPlus.taxModifiable === true) reasons.push('tax-modifiable')
        if (honeypot.contractOpenSource === false || honeypot.rootContractOpenSource === false) reasons.push('closed-source-contract')
        if (honeypot.isProxy === true) reasons.push('proxy-contract')
        if (providerDisagreement) reasons.push('security-provider-disagreement')
        if (moderateTax) reasons.push('moderate-tax')
        if (optionalProviderUnavailable) reasons.push('security-provider-unavailable')
        reasons.push('security-risk-caution')
        return {
            securityStatus: 'caution',
            securityScore: honeypot.riskLevel,
            securityReasons: unique(reasons),
        }
    }

    if (low) {
        return {
            securityStatus: 'low',
            securityScore: honeypot.riskLevel,
            securityReasons: ['security-risk-low'],
        }
    }

    return {
        securityStatus: 'unknown',
        securityScore: honeypot.riskLevel,
        securityReasons: ['security-provider-unavailable'],
    }
}

function ttlFor(status: SecurityStatus) {
    const config = getApiConfig().tokenSecurity
    if (status === 'blocked') return config.blockedCacheTtlMs
    if (status === 'unknown') return config.unknownCacheTtlMs
    return config.cacheTtlMs
}

export function createTokenSecurityService(overrides: Partial<SecurityDependencies> = {}) {
    const dependencies: SecurityDependencies = {
        getHoneypot: getHoneypotTokenSecurity,
        getGoPlus: getGoPlusTokenSecurity,
        now: Date.now,
        ...overrides,
    }

    async function refresh(address: string, signal?: AbortSignal, chainId = 56) {
        const chain = requireActiveTokenDiscoveryChain(chainId)
        const key = `${chainId}:${address}`
        const existing = pending.get(key)
        if (existing) return existing
        const request = (async () => {
            const [honeypotResult, goPlusResult] = await Promise.allSettled([
                chain.capabilities.honeypot
                    ? dependencies.getHoneypot(address, signal, chainId)
                    : unavailableHoneypotSecurity(address, undefined, chainId),
                chain.capabilities.goPlus
                    ? dependencies.getGoPlus(address, signal, chainId)
                    : unavailableGoPlusSecurity(address, undefined, chainId),
            ])
            const checkedAt = new Date(dependencies.now()).toISOString()
            const honeypot = honeypotResult.status === 'fulfilled'
                ? honeypotResult.value
                : unavailableHoneypotSecurity(address, checkedAt, chainId)
            const goPlus = goPlusResult.status === 'fulfilled'
                ? goPlusResult.value
                : unavailableGoPlusSecurity(address, checkedAt, chainId)
            const classification = classifyTokenSecurity({ honeypot, goPlus })
            const assessment = { chainId, address, honeypot, goPlus, ...classification }
            const previous = cache.get(key)
            const conclusive = assessment.securityStatus !== 'unknown'
            const now = dependencies.now()
            if (!conclusive && previous?.conclusive) {
                previous.refreshAfter = now + getApiConfig().tokenSecurity.errorCacheTtlMs
                return previous.assessment
            }
            const providerError = !honeypot.available && !goPlus.available &&
                (honeypotResult.status === 'rejected' || goPlusResult.status === 'rejected')
            const ttl = providerError
                ? getApiConfig().tokenSecurity.errorCacheTtlMs
                : ttlFor(assessment.securityStatus)
            setBoundedCacheEntry(cache, key, {
                assessment,
                conclusive,
                expiresAt: now + ttl,
                refreshAfter: now + ttl,
            })
            notifyAssessmentListeners(
                address,
                assessment,
                previous?.assessment ?? null,
            )
            return assessment
        })()
        pending.set(key, request)
        try {
            return await request
        } finally {
            if (pending.get(key) === request) pending.delete(key)
        }
    }

    function getCachedAndRefresh(addressValue: string, chainId = 56) {
        const address = normalizeAddress(addressValue)
        if (!address) return null
        const key = `${chainId}:${address}`
        const existing = cache.get(key)
        const now = dependencies.now()
        if (!existing || existing.refreshAfter <= now) {
            void refresh(address, undefined, chainId).catch(() => {
                const current = cache.get(key)
                if (current) current.refreshAfter = now + getApiConfig().tokenSecurity.errorCacheTtlMs
            })
        }
        return existing?.assessment ?? null
    }

    return { getCachedAndRefresh, refresh }
}

export const tokenSecurityService = createTokenSecurityService()

export function subscribeTokenSecurityAssessments(listener: AssessmentListener) {
    assessmentListeners.add(listener)
    return () => assessmentListeners.delete(listener)
}

export function clearTokenSecurityCacheForTest() {
    cache.clear()
    pending.clear()
}
