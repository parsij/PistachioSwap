import { describe, expect, it } from 'vitest'

import { getSwapReviewLabel } from './swapEligibility.js'

const erc20Token = {
    address: '0x1111111111111111111111111111111111111111',
    chainId: 56,
    isNative: false,
}

function reviewLabel(overrides = {}) {
    return getSwapReviewLabel({
        prepaidRequired: false,
        prepaidEnabled: true,
        executionMode: 'normal',
        gaslessMode: 'gasless',
        routingMode: 'normal',
        crossChainMode: 'cross-chain',
        nativeBalanceValue: 1_000_000_000_000_000_000n,
        nativeGasReserve: '0.0005',
        sellChainId: 56,
        sellToken: erc20Token,
        ...overrides,
    })
}

describe('getSwapReviewLabel', () => {
    it('uses the same Gas Assist review wording for prepaid same-chain swaps', () => {
        expect(reviewLabel({ prepaidRequired: true })).toBe('Review Gas Assisted Swap')
    })

    it('uses Gas Assist wording for BNB Chain cross-chain swaps below the gas reserve', () => {
        expect(reviewLabel({
            routingMode: 'cross-chain',
            nativeBalanceValue: 1n,
        })).toBe('Review Gas Assisted Swap')
    })

    it('keeps the normal wording when cross-chain Gas Assist is not required', () => {
        expect(reviewLabel({ routingMode: 'cross-chain' })).toBe('Review swap')
        expect(reviewLabel({
            routingMode: 'cross-chain',
            nativeBalanceValue: 0n,
            sellToken: { ...erc20Token, isNative: true },
        })).toBe('Review swap')
    })
})
