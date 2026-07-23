import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    getActiveHoneypotRequestCountForTest,
    honeypotRequest,
} from '../src/providers/security/honeypot-client.js'
import {
    normalizeHoneypotTokenSecurity,
    unavailableHoneypotSecurity,
} from '../src/providers/security/honeypot-token-security.js'
import {
    goPlusFlag,
    normalizeGoPlusTokenSecurity,
    unavailableGoPlusSecurity,
} from '../src/providers/security/goplus-token-security.js'
import {
    classifyTokenSecurity,
    clearTokenSecurityCacheForTest,
    createTokenSecurityService,
} from '../src/providers/security/token-security.js'

const token = '0x0000000000000000000000000000000000000011'

function honeypot(overrides = {}) {
    return { ...unavailableHoneypotSecurity(token), available: true, ...overrides }
}

function goPlus(overrides = {}) {
    return { ...unavailableGoPlusSecurity(token), available: true, ...overrides }
}

describe('token security normalization and classification', () => {
    it('validates exact returned token address and prefers summary flags', () => {
        const result = normalizeHoneypotTokenSecurity({
            token: { address: token },
            summary: {
                risk: 'unknown',
                flags: [{ flag: 'TRANSFER_BLOCKED', severity: 'medium' }],
            },
            simulationResult: { success: true },
            flags: [{ flag: 'deprecated-root-flag', severity: 'high' }],
        }, token)
        expect(result.available).toBe(true)
        expect(result.risk).toBe('unknown')
        expect(result.riskLevel).toBeNull()
        expect(result.simulationSuccess).toBe(true)
        expect(result.flags).toEqual([{
            code: 'TRANSFER_BLOCKED',
            severity: 'medium',
            description: null,
        }])
        expect(normalizeHoneypotTokenSecurity({
            token: { address: '0x0000000000000000000000000000000000000022' },
        }, token).available).toBe(false)
    })

    it('normalizes GoPlus string flags without turning missing values false', () => {
        expect(goPlusFlag('1')).toBe(true)
        expect(goPlusFlag('0')).toBe(false)
        expect(goPlusFlag('')).toBeNull()
        expect(normalizeGoPlusTokenSecurity({}, token)).toMatchObject({
            isHoneypot: null,
            cannotBuy: null,
            hasWhitelist: null,
            ownerCanChangeBalance: null,
        })
        expect(normalizeGoPlusTokenSecurity({
            transfer_pausable: '1',
            is_blacklisted: '1',
            is_whitelisted: '1',
        }, token)).toMatchObject({
            transferPausable: true,
            hasBlacklist: true,
            hasWhitelist: true,
        })
    })

    it.each([
        [{ isHoneypot: true }, {}, 'blocked'],
        [{ riskLevel: 90 }, {}, 'blocked'],
        [{ sellTaxPercent: '100' }, {}, 'blocked'],
        [{ riskLevel: 60 }, {}, 'high'],
        [{ sellTaxPercent: '50' }, {}, 'high'],
        [{ riskLevel: 20 }, {}, 'caution'],
        [{ riskLevel: 0 }, {}, 'low'],
        [{}, { isHoneypot: true }, 'blocked'],
        [{}, { cannotSellAll: true }, 'high'],
        [{}, { ownerCanChangeBalance: true }, 'high'],
    ])('maps provider evidence to %s security', (honeypotOverrides, goPlusOverrides, expected) => {
        expect(classifyTokenSecurity({
            honeypot: honeypot(honeypotOverrides),
            goPlus: goPlus(goPlusOverrides),
        }).securityStatus).toBe(expected)
    })

    it('does not fabricate low risk when providers are inconclusive', () => {
        const result = classifyTokenSecurity({
            honeypot: honeypot({ risk: 'unknown', riskLevel: null }),
            goPlus: unavailableGoPlusSecurity(token),
        })
        expect(result.securityScore).toBeNull()
        expect(result.securityStatus).not.toBe('low')
    })

    it('does not block merely for proxy, closed source, or blacklist capability', () => {
        expect(classifyTokenSecurity({
            honeypot: honeypot({ isProxy: true, contractOpenSource: false }),
            goPlus: goPlus({ hasBlacklist: true }),
        }).securityStatus).toBe('caution')
    })

    it.each([
        ['transfer pausable', { transferPausable: true }, 'transfer-pausable'],
        ['blacklist capable', { hasBlacklist: true }, 'blacklist-capability'],
        ['whitelist capable', { hasWhitelist: true }, 'whitelist-capability'],
    ])('treats %s as a caution capability', (_label, overrides, reason) => {
        const result = classifyTokenSecurity({
            honeypot: honeypot({ riskLevel: 0 }),
            goPlus: goPlus(overrides),
        })
        expect(result.securityStatus).toBe('caution')
        expect(result.securityReasons).toContain('transfer-control-capability')
        expect(result.securityReasons).toContain(reason)
        expect(result.securityReasons).not.toContain('transfer-restricted')
    })

    it('treats a medium transfer-blocked warning without failed simulation as caution', () => {
        const result = classifyTokenSecurity({
            honeypot: honeypot({
                simulationSuccess: true,
                flags: [{
                    code: 'TRANSFER_BLOCKED',
                    severity: 'medium',
                    description: 'Contract includes transfer controls',
                }],
            }),
            goPlus: goPlus({}),
        })
        expect(result).toMatchObject({ securityStatus: 'caution' })
        expect(result.securityReasons).toContain('transfer-control-capability')
        expect(result.securityReasons).toContain('provider-medium-transfer-warning')
        expect(result.securityReasons).not.toContain('transfer-simulation-failed')
    })

    it('requires failed simulation evidence before a transfer flag can block', () => {
        const warningOnly = classifyTokenSecurity({
            honeypot: honeypot({
                simulationSuccess: null,
                flags: [{
                    code: 'TRANSFER_BLOCKED',
                    severity: 'high',
                    description: null,
                }],
            }),
            goPlus: goPlus({}),
        })
        const observedFailure = classifyTokenSecurity({
            honeypot: honeypot({
                simulationSuccess: false,
                flags: [{
                    code: 'TRANSFER_BLOCKED',
                    severity: 'high',
                    description: null,
                }],
            }),
            goPlus: goPlus({}),
        })

        expect(warningOnly.securityStatus).toBe('caution')
        expect(observedFailure.securityStatus).toBe('blocked')
        expect(observedFailure.securityReasons).toContain('transfer-simulation-failed')
    })

    it('blocks a confirmed sell simulation failure but keeps provider outage nonblocking', () => {
        const sellFailure = classifyTokenSecurity({
            honeypot: honeypot({
                simulationSuccess: false,
                flags: [{ code: 'SELL_FAILED', severity: 'high', description: null }],
            }),
            goPlus: goPlus({}),
        })
        const unavailable = classifyTokenSecurity({
            honeypot: unavailableHoneypotSecurity(token),
            goPlus: unavailableGoPlusSecurity(token),
        })

        expect(sellFailure.securityStatus).toBe('blocked')
        expect(sellFailure.securityReasons).toContain('sell-simulation-failed')
        expect(unavailable.securityStatus).toBe('unknown')
    })

    it('does not let recognition or a manual allowlist override blocked security', () => {
        const security = classifyTokenSecurity({
            honeypot: honeypot({ isHoneypot: true }),
            goPlus: unavailableGoPlusSecurity(token),
            established: true,
        })
        expect(security.securityStatus).toBe('blocked')
    })
})

describe('security cache and provider concurrency', () => {
    const previousEnv = { ...process.env }

    beforeEach(() => {
        clearTokenSecurityCacheForTest()
        process.env = { ...previousEnv }
    })

    afterEach(() => {
        process.env = { ...previousEnv }
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('deduplicates concurrent explicit checks and serves the cached result', async () => {
        let resolveProvider
        const getHoneypot = vi.fn(() => new Promise((resolve) => {
            resolveProvider = resolve
        }))
        const getGoPlus = vi.fn(async () => goPlus({}))
        const service = createTokenSecurityService({ getHoneypot, getGoPlus })
        const first = service.refresh(token)
        const second = service.refresh(token)
        expect(getHoneypot).toHaveBeenCalledOnce()
        resolveProvider(honeypot({ riskLevel: 0 }))
        await expect(first).resolves.toMatchObject({ securityStatus: 'low' })
        await expect(second).resolves.toMatchObject({ securityStatus: 'low' })
        expect(service.peekCached(token)?.securityStatus).toBe('low')
        expect(service.getCachedAndRefresh(token)?.securityStatus).toBe('low')
        expect(getHoneypot).toHaveBeenCalledOnce()
    })

    it('never launches providers from ordinary cached wallet reads', async () => {
        const getHoneypot = vi.fn(async () => honeypot({ riskLevel: 0 }))
        const getGoPlus = vi.fn(async () => goPlus({}))
        const service = createTokenSecurityService({ getHoneypot, getGoPlus })

        expect(service.getCachedAndRefresh(token)).toBeNull()
        expect(service.peekCached(token)).toBeNull()
        await Promise.resolve()

        expect(getHoneypot).not.toHaveBeenCalled()
        expect(getGoPlus).not.toHaveBeenCalled()
    })

    it('uses the longer blocked TTL and brief provider-error TTL for explicit stale refreshes', async () => {
        process.env.TOKEN_SECURITY_CACHE_TTL_MS = '1000'
        process.env.TOKEN_SECURITY_BLOCKED_CACHE_TTL_MS = '2000'
        process.env.TOKEN_SECURITY_ERROR_CACHE_TTL_MS = '50'
        let now = 1_000
        const blockedProvider = vi.fn(async () => honeypot({ isHoneypot: true }))
        const service = createTokenSecurityService({
            getHoneypot: blockedProvider,
            getGoPlus: vi.fn(async () => unavailableGoPlusSecurity(token)),
            now: () => now,
        })
        await service.refresh(token)
        now += 1_500
        expect(service.refreshIfStale(token)?.securityStatus).toBe('blocked')
        expect(blockedProvider).toHaveBeenCalledOnce()
        now += 600
        service.refreshIfStale(token)
        await vi.waitFor(() => expect(blockedProvider).toHaveBeenCalledTimes(2))

        clearTokenSecurityCacheForTest()
        const errorToken = '0x0000000000000000000000000000000000000099'
        const unavailable = vi.fn(async () => { throw new Error('outage') })
        const optionalUnavailable = vi.fn(async () => unavailableGoPlusSecurity(errorToken))
        const errorService = createTokenSecurityService({
            getHoneypot: unavailable,
            getGoPlus: optionalUnavailable,
            now: () => now,
        })
        await expect(errorService.refresh(errorToken)).resolves.toMatchObject({
            securityStatus: 'unknown',
        })
        now += 40
        errorService.refreshIfStale(errorToken)
        expect(unavailable).toHaveBeenCalledOnce()
        expect(optionalUnavailable).toHaveBeenCalledOnce()
        now += 20
        errorService.refreshIfStale(errorToken)
        await vi.waitFor(() => expect(unavailable).toHaveBeenCalledTimes(2))
        expect(optionalUnavailable).toHaveBeenCalledTimes(2)
    })

    it('bounds Honeypot requests at the configured concurrency', async () => {
        process.env.HONEYPOT_ENABLED = 'true'
        process.env.HONEYPOT_API_KEY = ''
        process.env.TOKEN_SECURITY_CONCURRENCY = '2'
        let release
        const gate = new Promise((resolve) => { release = resolve })
        let maximum = 0
        vi.stubGlobal('fetch', vi.fn(async () => {
            maximum = Math.max(maximum, getActiveHoneypotRequestCountForTest())
            await gate
            return new Response('{}', {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        }))
        const requests = Array.from({ length: 5 }, (_, index) =>
            honeypotRequest({
                chainId: 56,
                address: `0x${String(index + 100).padStart(40, '0')}`,
            }),
        )
        await vi.waitFor(() => expect(getActiveHoneypotRequestCountForTest()).toBe(2))
        release()
        await Promise.all(requests)
        expect(maximum).toBe(2)
        expect(getActiveHoneypotRequestCountForTest()).toBe(0)
        for (const [url, options] of vi.mocked(fetch).mock.calls) {
            expect(new URL(String(url)).searchParams.get('chainID')).toBe('56')
            expect(options?.headers).not.toHaveProperty('X-API-KEY')
        }
    })
})
