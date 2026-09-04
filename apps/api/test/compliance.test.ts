import type { Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    ComplianceError,
    createComplianceService,
} from '../src/compliance/service.js'

const sanctioned = '0x1111111111111111111111111111111111111111'
const clear = '0x2222222222222222222222222222222222222222'
const lookalike = '0x1111111111111111111111111111111111111112'
const rawIp = '203.0.113.9'

const ENV_KEYS = [
    'COMPLIANCE_TEST_ENABLED',
    'COMPLIANCE_ENABLED',
    'COMPLIANCE_FAIL_CLOSED',
    'COMPLIANCE_TRUST_CLOUDFLARE_GEO',
    'OFAC_SDN_URL',
    'OFAC_CONSOLIDATED_URL',
    'OFAC_REFRESH_INTERVAL_MS',
    'OFAC_MAX_LIST_AGE_MS',
    'COMPLIANCE_SCREEN_CACHE_MS',
    'TRM_SANCTIONS_ENABLED',
] as const

const originalEnv = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>

function ofacXml(address = sanctioned) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<sdnList>
  <sdnEntry>
    <idList>
      <id>
        <idType>Digital Currency Address - ETH</idType>
        <idNumber>${address}</idNumber>
      </id>
    </idList>
  </sdnEntry>
</sdnList>`
}

function installHealthyOfac(address = sanctioned) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(ofacXml(address), {
        status: 200,
        headers: { 'content-type': 'application/xml' },
    })))
}

function fakePool() {
    const calls: Array<{ text: string; values: unknown[] | undefined }> = []
    const pool = {
        query: vi.fn(async (text: string, values?: unknown[]) => {
            calls.push({ text, values })
            if (text.includes('INSERT INTO compliance_checks')) {
                return { rows: [{ id: 'check-1' }] }
            }
            return { rows: [] }
        }),
    } as unknown as Pool
    return { pool, calls }
}

beforeEach(() => {
    process.env.COMPLIANCE_TEST_ENABLED = 'true'
    process.env.COMPLIANCE_FAIL_CLOSED = 'true'
    process.env.COMPLIANCE_TRUST_CLOUDFLARE_GEO = 'false'
    process.env.OFAC_SDN_URL = 'https://example.invalid/sdn.xml'
    process.env.OFAC_CONSOLIDATED_URL = 'https://example.invalid/consolidated.xml'
    process.env.OFAC_REFRESH_INTERVAL_MS = '60000'
    process.env.OFAC_MAX_LIST_AGE_MS = '300000'
    process.env.COMPLIANCE_SCREEN_CACHE_MS = '10000'
    process.env.TRM_SANCTIONS_ENABLED = 'false'
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    for (const key of ENV_KEYS) {
        const value = originalEnv[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
})

describe('OFAC compliance service', () => {
    it('blocks an exact OFAC digital-currency address', async () => {
        installHealthyOfac()
        const { pool, calls } = fakePool()
        const service = createComplianceService(pool)

        const result = await service.screen({
            walletAddress: sanctioned,
            chainId: 1,
            action: 'test-exact-match',
            persist: false,
            clientIp: rawIp,
        })

        expect(result.decision).toBe('block')
        expect(result.reasonCode).toBe('OFAC_ADDRESS_MATCH')
        expect(calls).toHaveLength(2)
        expect(calls[0]?.text).toContain('INSERT INTO compliance_checks')
        expect(calls[1]?.text).toContain('INSERT INTO compliance_cases')
    })

    it('does not fuzzy-block a one-character address lookalike', async () => {
        installHealthyOfac()
        const { pool, calls } = fakePool()
        const service = createComplianceService(pool)

        const result = await service.screen({
            walletAddress: lookalike,
            chainId: 1,
            action: 'test-lookalike',
            persist: false,
        })

        expect(result.decision).toBe('allow')
        expect(result.reasonCode).toBe('CLEAR')
        expect(calls).toHaveLength(0)
    })

    it('fails closed when the OFAC list is unavailable', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('network unavailable')
        }))
        const { pool } = fakePool()
        const service = createComplianceService(pool)

        await expect(service.enforce({
            walletAddress: clear,
            chainId: 1,
            action: 'test-unavailable',
            persist: false,
        })).rejects.toMatchObject<Partial<ComplianceError>>({
            code: 'COMPLIANCE_UNAVAILABLE',
            statusCode: 503,
        })
    })

    it('fails closed when the last-known-good OFAC snapshot becomes stale', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        installHealthyOfac()
        const { pool } = fakePool()
        const service = createComplianceService(pool)

        expect((await service.screen({
            walletAddress: clear,
            chainId: 1,
            action: 'prime-snapshot',
            persist: false,
        })).decision).toBe('allow')

        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('refresh unavailable')
        }))
        vi.advanceTimersByTime(300001)

        await expect(service.enforce({
            walletAddress: clear,
            chainId: 1,
            action: 'test-stale',
            persist: false,
        })).rejects.toMatchObject<Partial<ComplianceError>>({
            code: 'COMPLIANCE_UNAVAILABLE',
            statusCode: 503,
        })
    })

    it('does not persist a normal background clearance', async () => {
        installHealthyOfac()
        const { pool, calls } = fakePool()
        const service = createComplianceService(pool)

        const result = await service.screen({
            walletAddress: clear,
            chainId: 56,
            action: 'background-wallet-screen',
            persist: false,
            clientIp: rawIp,
        })

        expect(result.decision).toBe('allow')
        expect(calls).toHaveLength(0)
    })

    it('persists only the compact audit row for a clear transaction gate', async () => {
        installHealthyOfac()
        const { pool, calls } = fakePool()
        const service = createComplianceService(pool)

        const result = await service.screen({
            walletAddress: clear,
            chainId: 56,
            action: 'transaction-gate',
            persist: true,
            clientIp: rawIp,
            transactionHash: `0x${'ab'.repeat(32)}`,
        })

        expect(result.decision).toBe('allow')
        expect(calls).toHaveLength(1)
        expect(calls[0]?.text).toContain('INSERT INTO compliance_checks')
        expect(calls[0]?.text).not.toContain('client_ip')
        expect(calls[0]?.values).not.toContain(rawIp)
    })

    it('creates a separate evidence case when screening blocks a request', async () => {
        installHealthyOfac()
        const { pool, calls } = fakePool()
        const service = createComplianceService(pool)

        await service.screen({
            walletAddress: sanctioned,
            chainId: 56,
            action: 'blocked-transaction-gate',
            persist: true,
            clientIp: rawIp,
        })

        expect(calls).toHaveLength(2)
        expect(calls[0]?.text).toContain('INSERT INTO compliance_checks')
        expect(calls[1]?.text).toContain('INSERT INTO compliance_cases')
        expect(calls[1]?.values).toContain(rawIp)
    })
})
