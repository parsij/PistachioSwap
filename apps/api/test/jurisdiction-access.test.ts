import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { jurisdictionAccess } from '../src/compliance/jurisdiction.js'

const ENV_KEYS = [
    'COMPLIANCE_TEST_ENABLED',
    'COMPLIANCE_TRUST_CLOUDFLARE_GEO',
    'COMPLIANCE_BLOCKED_COUNTRY_CODES',
    'COMPLIANCE_BLOCKED_REGION_CODES',
] as const

const originalEnv = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>

beforeEach(() => {
    process.env.COMPLIANCE_TEST_ENABLED = 'true'
    process.env.COMPLIANCE_TRUST_CLOUDFLARE_GEO = 'true'
    process.env.COMPLIANCE_BLOCKED_COUNTRY_CODES = 'CU,IR,KP,RU,UA'
    process.env.COMPLIANCE_BLOCKED_REGION_CODES = ''
})

afterEach(() => {
    for (const key of ENV_KEYS) {
        const value = originalEnv[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
})

describe('jurisdiction access gate', () => {
    it('blocks a configured country from the hosted interface', () => {
        expect(jurisdictionAccess({ 'cf-ipcountry': 'RU' })).toMatchObject({
            allowed: false,
            decision: 'block',
            reasonCode: 'JURISDICTION_RESTRICTED',
        })
    })

    it('allows a country that is not configured as blocked', () => {
        expect(jurisdictionAccess({ 'cf-ipcountry': 'US' })).toMatchObject({
            allowed: true,
            decision: 'allow',
            reasonCode: 'CLEAR',
        })
    })

    it('does not trust client-supplied geography when Cloudflare geo trust is disabled', () => {
        process.env.COMPLIANCE_TRUST_CLOUDFLARE_GEO = 'false'
        expect(jurisdictionAccess({ 'cf-ipcountry': 'RU' })).toMatchObject({
            allowed: true,
            decision: 'allow',
            reasonCode: 'GEO_UNTRUSTED',
        })
    })

    it('blocks a configured country and region pair', () => {
        process.env.COMPLIANCE_BLOCKED_COUNTRY_CODES = ''
        process.env.COMPLIANCE_BLOCKED_REGION_CODES = 'UA:43'
        expect(jurisdictionAccess({
            'cf-ipcountry': 'UA',
            'cf-region-code': '43',
        })).toMatchObject({
            allowed: false,
            decision: 'block',
            reasonCode: 'JURISDICTION_RESTRICTED',
        })
    })
})
