import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MoralisSponsorshipTokenEvidence } from '../src/providers/moralis/sponsorship-token-evidence.js'
import { tokenEvidenceInternals } from '../src/gas-assist/prepaid/token-evidence.js'

const address = '0x21caef8a43163eea865baee23b9c2e327696a3bf'
const {
    applyDangerousBypass,
    classifyMoralisSecurity,
    numericMicros,
    optionalReferenceDeviationBps,
} = tokenEvidenceInternals

function moralis(
    overrides: Partial<MoralisSponsorshipTokenEvidence> = {},
): MoralisSponsorshipTokenEvidence {
    return {
        available: true,
        checkedAt: new Date('2026-07-21T17:00:00Z'),
        tokenAddress: address,
        priceUsd: '4068.896095',
        liquidityUsd: '1000000',
        securityScore: 85,
        possibleSpam: false,
        verifiedContract: true,
        pairAddress: null,
        exchangeAddress: null,
        exchangeName: 'Uniswap v3',
        ...overrides,
    }
}

afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

describe('database-whitelisted sponsorship evidence', () => {
    it('keeps external scanner classifications diagnostic', () => {
        expect(classifyMoralisSecurity(moralis())).toBe('trusted')
        expect(classifyMoralisSecurity(moralis({ possibleSpam: true })))
            .toBe('blocked')
        expect(classifyMoralisSecurity(moralis({ available: false })))
            .toBe('unknown')
    })

    it('normalizes DexScreener numeric liquidity into USD micros', () => {
        expect(numericMicros(1_234_567.891234)).toBe(1_234_567_891_234n)
        expect(numericMicros(Number.NaN)).toBeNull()
        expect(numericMicros(-1)).toBeNull()
    })

    it('does not require an external reference price', () => {
        expect(optionalReferenceDeviationBps(4_000_000_000n, null)).toBe(0)
        expect(optionalReferenceDeviationBps(
            4_000_000_000n,
            3_960_000_000n,
        )).toBe(100)
    })
})

describe('explicit emergency evidence bypass', () => {
    const evidence = {
        priceUsdMicros: 4_000_000_000n,
        priceDeviationBps: 9_999,
        liquidityUsdMicros: 0n,
        securityStatus: 'trusted' as const,
        transferBehavior: 'exact' as const,
    }

    it('bypasses only market evidence when explicitly enabled', () => {
        vi.stubEnv('DANGEROUSLY_BYPASS_SPONSORSHIP_TOKEN_CHECKS', 'true')
        vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        const result = applyDangerousBypass(evidence)
        expect(result.dangerousBypassApplied).toBe(true)
        expect(result.priceDeviationBps).toBe(0)
        expect(result.liquidityUsdMicros).toBeGreaterThan(0n)
        expect(result.securityStatus).toBe('trusted')
        expect(result.transferBehavior).toBe('exact')
    })

    it('does not alter evidence when disabled', () => {
        vi.stubEnv('DANGEROUSLY_BYPASS_SPONSORSHIP_TOKEN_CHECKS', 'false')
        expect(applyDangerousBypass(evidence)).toEqual({
            ...evidence,
            dangerousBypassApplied: false,
        })
    })
})
