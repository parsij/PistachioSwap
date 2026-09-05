import { complianceRequestGeo } from './service.js'

export type JurisdictionAccessDecision = {
    allowed: boolean
    decision: 'allow' | 'block'
    reasonCode: 'CLEAR' | 'COMPLIANCE_DISABLED' | 'GEO_UNTRUSTED' | 'JURISDICTION_RESTRICTED'
}

function boolEnv(name: string, fallback: boolean) {
    const raw = process.env[name]?.trim().toLowerCase()
    if (!raw) return fallback
    if (raw === 'true') return true
    if (raw === 'false') return false
    throw new Error(`${name} must be true or false.`)
}

function csvSet(name: string, fallback: string) {
    return new Set((process.env[name]?.trim() || fallback)
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean))
}

function complianceEnabled() {
    const isTest = process.env.NODE_ENV === 'test'
        || process.env.VITEST === 'true'
        || process.argv.some((argument) => argument.includes('vitest'))
    return isTest
        ? boolEnv('COMPLIANCE_TEST_ENABLED', false)
        : boolEnv('COMPLIANCE_ENABLED', true)
}

export function jurisdictionAccess(headers: Record<string, unknown>): JurisdictionAccessDecision {
    if (!complianceEnabled()) {
        return { allowed: true, decision: 'allow', reasonCode: 'COMPLIANCE_DISABLED' }
    }

    if (!boolEnv('COMPLIANCE_TRUST_CLOUDFLARE_GEO', false)) {
        return { allowed: true, decision: 'allow', reasonCode: 'GEO_UNTRUSTED' }
    }

    const { countryCode, regionCode } = complianceRequestGeo(headers)
    const blockedCountries = csvSet('COMPLIANCE_BLOCKED_COUNTRY_CODES', 'CU,IR,KP')
    const blockedRegions = csvSet('COMPLIANCE_BLOCKED_REGION_CODES', '')
    const regionKey = countryCode && regionCode ? `${countryCode}:${regionCode}` : null

    if (
        (countryCode && blockedCountries.has(countryCode))
        || (regionKey && blockedRegions.has(regionKey))
    ) {
        return { allowed: false, decision: 'block', reasonCode: 'JURISDICTION_RESTRICTED' }
    }

    return { allowed: true, decision: 'allow', reasonCode: 'CLEAR' }
}
