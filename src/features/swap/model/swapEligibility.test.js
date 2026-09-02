import { describe, expect, it } from 'vitest'

import {
    deriveSwapEligibility,
    getCrossChainGasAssistTier,
    getSwapReviewLabel,
} from './swapEligibility.js'

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

    it('keeps neutral review wording until the live gas estimate selects the tier', () => {
        expect(reviewLabel({
            routingMode: 'cross-chain',
            nativeBalanceValue: 1n,
        })).toBe('Review swap')
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

describe('getCrossChainGasAssistTier', () => {
    const input = {
        routingMode: 'cross-chain',
        crossChainMode: 'cross-chain',
        nativeBalanceValue: 40n,
        nativeGasReserve: '0.0000000000000001',
        requiredNativeGasWei: '50',
        gasEstimateUnavailable: false,
        preparationStatus: 'ready',
        sellChainId: 56,
        sellToken: erc20Token,
    }

    it('requires Gas Assist below the live minimum gas requirement', () => {
        expect(getCrossChainGasAssistTier(input)).toBe('required')
    })

    it('offers both paths above the minimum but below the recommended reserve', () => {
        expect(getCrossChainGasAssistTier({
            ...input,
            nativeBalanceValue: 60n,
        })).toBe('choice')
    })

    it('uses the normal path at or above the recommended reserve', () => {
        expect(getCrossChainGasAssistTier({
            ...input,
            nativeBalanceValue: 100n,
        })).toBe('normal')
    })

    it('offers both paths when the live estimate is unavailable below the reserve', () => {
        expect(getCrossChainGasAssistTier({
            ...input,
            requiredNativeGasWei: null,
            gasEstimateUnavailable: true,
            nativeBalanceValue: 60n,
        })).toBe('choice')
    })
})

function crossChainEligibility(overrides = {}) {
    return deriveSwapEligibility({
        walletState: { isConnected: true, isCorrectNetwork: true },
        walletAddress: '0x0000000000000000000000000000000000000001',
        sellToken: { ...erc20Token, decimals: 6, rawBalance: '1000000' },
        buyToken: { ...erc20Token, chainId: 8453, decimals: 6 },
        activeAmountSide: 'sell',
        activeAmountIn: '270078',
        activeBuyAmountIn: null,
        sellAmount: '0.270078',
        buyAmount: '0.37842',
        sellDisplayPrice: '0.7035',
        buyDisplayPrice: '1',
        routingMode: 'cross-chain',
        crossChainMode: 'cross-chain',
        gaslessMode: 'gasless',
        executionMode: 'normal',
        activeQuote: {},
        activeQuoteStatus: 'success',
        currentCrossChainRoute: {
            outputAmount: '378420',
            costs: { routeCostUsd: '0.23' },
        },
        crossChainRouteExpired: false,
        crossChainExactOutputUnsupported: false,
        transactionStatus: 'idle',
        nativeBalanceValue: 0n,
        nativeGasReserve: '0.0005',
        maxCostToInputBps: 5_000,
        sellChainId: 56,
        buyChainId: 8453,
        prepaidRequired: false,
        prepaidEnabled: true,
        crossChainGasAssistExpected: true,
        ...overrides,
    })
}

describe('cross-chain economic safety', () => {
    it('blocks review when route costs consume the displayed sell value', () => {
        const result = crossChainEligibility()
        expect(result.economicViability).toMatchObject({
            viable: false,
            inputValueUsd: '0.189999873',
            totalKnownCostsUsd: '0.23',
        })
        expect(result.action).toMatchObject({
            type: 'economically-invalid',
            enabled: false,
        })
    })

    it('uses the sponsored all-in cost instead of the unsponsored route estimate', () => {
        const result = crossChainEligibility({
            sellDisplayPrice: '10',
            currentCrossChainRoute: {
                outputAmount: '2000000',
                costs: { routeCostUsd: '0.1' },
            },
            crossChainGasAssistPreview: {
                grossInputAmountRaw: '270078',
                netSwapAmountRaw: '250000',
                paymentAmountRaw: '20078',
                expectedOutputRaw: '2000000',
                minimumOutputRaw: '1900000',
                amountsUsd: {
                    tradeNotional: '10',
                    totalPrepayment: '0.2',
                    routeCost: '2.6',
                    allInCost: '2.8',
                },
            },
        })
        expect(result.economicViability.sponsoredAllInCostUsd).toBe('2.8')
        expect(result.action.type).toBe('economically-invalid')
    })
})
