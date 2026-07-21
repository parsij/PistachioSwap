import { describe, expect, it } from 'vitest'

import { unavailableGoPlusSecurity } from '../src/providers/security/goplus-token-security.js'
import { unavailableHoneypotSecurity } from '../src/providers/security/honeypot-token-security.js'
import { tokenEvidenceInternals } from '../src/gas-assist/prepaid/token-evidence.js'

const address = '0x21caef8a43163eea865baee23b9c2e327696a3bf'
const {
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

describe('payment-token price reference evidence', () => {
    it('allows an authoritative price when the optional reference is unavailable', () => {
        expect(optionalReferenceDeviationBps(4_000_000_000n, null)).toBe(0)
    })

    it('still calculates deviation when the optional reference is available', () => {
        expect(optionalReferenceDeviationBps(4_000_000_000n, 3_960_000_000n)).toBe(100)
    })

    it('rejects a missing authoritative price', () => {
        expect(optionalReferenceDeviationBps(null, 4_000_000_000n)).toBeNull()
    })
})

describe('exact sponsorship-transfer evidence', () => {
    it('accepts a successful zero-tax Honeypot simulation when GoPlus is unavailable', () => {
        expect(hasExactTransferEvidence({
            honeypot: successfulHoneypot(),
            goPlus: unavailableGoPlusSecurity(address),
        })).toBe(true)
    })

    it('rejects missing or failed Honeypot simulations', () => {
        expect(hasExactTransferEvidence({
            honeypot: unavailableHoneypotSecurity(address),
            goPlus: unavailableGoPlusSecurity(address),
        })).toBe(false)
        expect(hasExactTransferEvidence({
            honeypot: { ...successfulHoneypot(), simulationSuccess: false },
            goPlus: unavailableGoPlusSecurity(address),
        })).toBe(false)
    })

    it('rejects nonzero simulated transfer taxes', () => {
        expect(hasExactTransferEvidence({
            honeypot: { ...successfulHoneypot(), transferTaxPercent: '0.01' },
            goPlus: unavailableGoPlusSecurity(address),
        })).toBe(false)
    })

    it('requires a present GoPlus result not to contradict the simulation', () => {
        const safeGoPlus = {
            ...unavailableGoPlusSecurity(address),
            available: true,
            transferTaxFraction: '0',
            ownerCanChangeBalance: false,
            taxModifiable: false,
        }
        expect(hasExactTransferEvidence({
            honeypot: successfulHoneypot(),
            goPlus: safeGoPlus,
        })).toBe(true)
        expect(hasExactTransferEvidence({
            honeypot: successfulHoneypot(),
            goPlus: { ...safeGoPlus, ownerCanChangeBalance: true },
        })).toBe(false)
    })
})
