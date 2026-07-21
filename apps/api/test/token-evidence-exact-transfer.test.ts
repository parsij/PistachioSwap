import { describe, expect, it } from 'vitest'

import { unavailableHoneypotSecurity } from '../src/providers/security/honeypot-token-security.js'
import type { MoralisSponsorshipTokenEvidence } from '../src/providers/moralis/sponsorship-token-evidence.js'
import { tokenEvidenceInternals } from '../src/gas-assist/prepaid/token-evidence.js'

const address = '0x21caef8a43163eea865baee23b9c2e327696a3bf'
const {
    classifyMoralisSecurity,
    hasExactTransferEvidence,
    optionalReferenceDeviationBps,
} = tokenEvidenceInternals

function successfulHoneypot() {
    return {
        ...unavailableHoneypotSecurity(address),
        available: true,
        simulationSuccess: true,
        sellTaxPercent: '0',
        transferTaxPercent: '0',
    }
}

function moralis(overrides: Partial<MoralisSponsorshipTokenEvidence> = {}): MoralisSponsorshipTokenEvidence {
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

describe('Moralis sponsorship security classification', () => {
    it('marks a verified high-score token as trusted', () => {
        expect(classifyMoralisSecurity(moralis())).toBe('trusted')
    })

    it('blocks spam and very-low-score tokens', () => {
        expect(classifyMoralisSecurity(moralis({ possibleSpam: true }))).toBe('blocked')
        expect(classifyMoralisSecurity(moralis({ securityScore: 10 }))).toBe('blocked')
    })

    it('fails closed when Moralis is unavailable', () => {
        expect(classifyMoralisSecurity(moralis({ available: false }))).toBe('unknown')
    })
})

describe('payment-token price reference evidence', () => {
    it('allows an authoritative price when the Moralis reference price is unavailable', () => {
        expect(optionalReferenceDeviationBps(4_000_000_000n, null)).toBe(0)
    })

    it('calculates deviation when the Moralis reference price is available', () => {
        expect(optionalReferenceDeviationBps(4_000_000_000n, 3_960_000_000n)).toBe(100)
    })
})

describe('exact sponsorship-transfer evidence', () => {
    it('accepts a successful zero-tax Honeypot simulation without GoPlus', () => {
        expect(hasExactTransferEvidence(successfulHoneypot())).toBe(true)
    })

    it('rejects missing or failed Honeypot simulations', () => {
        expect(hasExactTransferEvidence(unavailableHoneypotSecurity(address))).toBe(false)
        expect(hasExactTransferEvidence({
            ...successfulHoneypot(),
            simulationSuccess: false,
        })).toBe(false)
    })

    it('rejects nonzero simulated transfer taxes', () => {
        expect(hasExactTransferEvidence({
            ...successfulHoneypot(),
            transferTaxPercent: '0.01',
        })).toBe(false)
    })
})
