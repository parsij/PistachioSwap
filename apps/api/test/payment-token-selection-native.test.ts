import { describe, expect, it } from 'vitest'

import { NATIVE_TOKEN_ADDRESS } from '../src/lib/address.js'
import {
    selectPaymentToken,
    type PaymentTokenCandidate,
} from '../src/gas-assist/prepaid/payment-token-selection.js'

const sellToken = '0x21caef8a43163eea865baee23b9c2e327696a3bf'

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

describe('payment-token selection for native BNB output', () => {
    it('accepts native as the buy token and selects the eligible sell token', () => {
        const result = selectPaymentToken({
            candidates: [candidate()],
            requiredPaymentRawByToken: new Map([[sellToken, 10n]]),
            sellToken,
            buyToken: NATIVE_TOKEN_ADDRESS,
            now: new Date('2026-07-21T16:01:00Z'),
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
            now: new Date('2026-07-21T16:01:00Z'),
            configuredMinimumLiquidityUsdMicros: 0n,
        })

        expect(result.selection).toBeNull()
        expect(result.rejections).toEqual([])
    })
})
