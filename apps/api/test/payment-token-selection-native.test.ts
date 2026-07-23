import { afterEach, describe, expect, it, vi } from 'vitest'

import { NATIVE_TOKEN_ADDRESS } from '../src/lib/address.js'
import {
    evaluatePaymentTokenCandidate,
    selectPaymentToken,
    type PaymentTokenCandidate,
} from '../src/gas-assist/prepaid/payment-token-selection.js'

const sellToken = '0x21caef8a43163eea865baee23b9c2e327696a3bf'
const now = new Date('2026-07-21T16:01:00Z')

function candidate(overrides: Partial<PaymentTokenCandidate> = {}): PaymentTokenCandidate {
    return {
        chainId: 56,
        tokenAddress: sellToken,
        symbol: 'XAUT',
        decimals: 6,
        onchainDecimals: 6,
        enabled: true,
        feePaymentEnabled: true,
        isStablecoin: false,
        paymentPriority: 100,
        minimumLiquidityUsdMicros: 0n,
        maximumPriceAgeSeconds: 300,
        maximumPriceDeviationBps: 300,
        exactTransferRequired: true,
        feeOnTransferAllowed: false,
        rebasingAllowed: false,
        strictSecurityRequired: true,
        priceUsdMicros: 4_000_000_000n,
        priceObservedAt: new Date('2026-07-21T16:00:00Z'),
        priceDeviationBps: 0,
        liquidityUsdMicros: 1_000_000_000n,
        balanceRaw: 1_000n,
        transferBehavior: 'exact',
        securityStatus: 'low',
        ...overrides,
    }
}

function evaluate(overrides: Partial<PaymentTokenCandidate> = {}) {
    return evaluatePaymentTokenCandidate({
        candidate: candidate(overrides),
        requiredPaymentRaw: 10n,
        now,
        configuredMinimumLiquidityUsdMicros: 10_000n,
    })
}

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('dangerous sponsorship token-check bypass', () => {
    it('bypasses security, liquidity, transfer, price-age, and deviation gates', () => {
        vi.stubEnv('DANGEROUSLY_BYPASS_SPONSORSHIP_TOKEN_CHECKS', 'true')

        expect(evaluate({
            priceObservedAt: new Date('2020-01-01T00:00:00Z'),
            priceDeviationBps: 10_000,
            liquidityUsdMicros: 0n,
            transferBehavior: 'fee-on-transfer',
            securityStatus: 'blocked',
            strictSecurityRequired: true,
        })).toBeNull()
    })

    it('still requires whitelist enablement, correct decimals, a price, and balance', () => {
        vi.stubEnv('DANGEROUSLY_BYPASS_SPONSORSHIP_TOKEN_CHECKS', 'true')

        expect(evaluate({ enabled: false })).toBe('PAYMENT_TOKEN_DISABLED')
        expect(evaluate({ onchainDecimals: 18 })).toBe('PAYMENT_TOKEN_DECIMALS_MISMATCH')
        expect(evaluate({ priceUsdMicros: 0n })).toBe('PAYMENT_TOKEN_PRICE_UNAVAILABLE')
        expect(evaluate({ balanceRaw: 9n })).toBe('PAYMENT_TOKEN_BALANCE_LOW')
    })

    it('does not bypass checks unless the flag is exactly true', () => {
        vi.stubEnv('DANGEROUSLY_BYPASS_SPONSORSHIP_TOKEN_CHECKS', 'false')
        expect(evaluate({ securityStatus: 'blocked' })).toBe('PAYMENT_TOKEN_SECURITY_UNCONFIRMED')
    })
})

describe('Moralis-backed payment-token safety', () => {
    it('rejects unavailable Moralis evidence', () => {
        expect(evaluate({ securityStatus: 'unknown' })).toBe('PAYMENT_TOKEN_MORALIS_UNAVAILABLE')
    })

    it('rejects Moralis spam or blocked evidence', () => {
        expect(evaluate({ securityStatus: 'blocked' })).toBe('PAYMENT_TOKEN_SECURITY_UNCONFIRMED')
    })

    it('requires trusted or low Moralis status in strict mode', () => {
        expect(evaluate({ securityStatus: 'caution' })).toBe('PAYMENT_TOKEN_SECURITY_UNCONFIRMED')
    })

    it('allows a manually reviewed token with strong Moralis evidence when transfer simulation is unavailable', () => {
        expect(evaluate({
            strictSecurityRequired: false,
            transferBehavior: 'unknown',
            securityStatus: 'low',
        })).toBeNull()
    })

    it('does not let weak Moralis evidence replace transfer evidence', () => {
        expect(evaluate({
            strictSecurityRequired: false,
            transferBehavior: 'unknown',
            securityStatus: 'caution',
        })).toBe('PAYMENT_TOKEN_TRANSFER_UNKNOWN')
    })

    it('still rejects explicit fee-on-transfer and rebasing behavior', () => {
        expect(evaluate({ transferBehavior: 'fee-on-transfer' })).toBe('FEE_ON_TRANSFER_UNSUPPORTED')
        expect(evaluate({ transferBehavior: 'rebasing' })).toBe('REBASING_TOKEN_UNSUPPORTED')
    })
})

describe('payment-token selection for native BNB output', () => {
    it('accepts native as the buy token and selects the eligible sell token', () => {
        const result = selectPaymentToken({
            candidates: [candidate()],
            requiredPaymentRawByToken: new Map([[sellToken, 10n]]),
            sellToken,
            buyToken: NATIVE_TOKEN_ADDRESS,
            now,
            configuredMinimumLiquidityUsdMicros: 0n,
        })

        expect(result.rejections).toEqual([])
        expect(result.selection?.candidate.tokenAddress).toBe(sellToken)
        expect(result.selection?.reason).toBe('eligible-sell-token')
    })

    it('still rejects an invalid non-native buy-token string', () => {
        const result = selectPaymentToken({
            candidates: [candidate()],
            requiredPaymentRawByToken: new Map([[sellToken, 10n]]),
            sellToken,
            buyToken: 'not-an-address',
            now,
            configuredMinimumLiquidityUsdMicros: 0n,
        })

        expect(result.selection).toBeNull()
        expect(result.rejections).toEqual([])
    })
})
