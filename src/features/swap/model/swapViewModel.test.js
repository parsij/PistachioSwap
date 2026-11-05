import { normalizeCrossChainRoute } from '../../cross-chain/services/crossChainRoutes.js'
import { formatCompactRate } from './swapDisplay.js'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
    formatTokenDisplayAmount,
    getSameChainReviewTokenAmounts,
    getNetworkFeeDisplayData,
    getPrimaryActionPresentation,
    getWalletBalanceNotice,
} from './swapViewModel.js'

describe('getWalletBalanceNotice', () => {
    it('does not surface unrelated all-chain refresh failures on the active swap card', () => {
        expect(getWalletBalanceNotice({
            activeChainId: 56,
            backendWalletTokens: [{ chainId: 56 }],
            walletTokenFailedChainIds: [25, 146, 204, 1088, 1284, 5000, 34443, 167000],
        })).toBeNull()
    })

    it('surfaces a refresh failure when the active swap network itself failed', () => {
        expect(getWalletBalanceNotice({
            activeChainId: 56,
            backendWalletTokens: [{ chainId: 56 }],
            walletTokenFailedChainIds: [25, 56, 146],
        })).toBe('Some network balances could not be refreshed: BNB Smart Chain.')
    })

    it('preserves full wallet-load and stale-balance notices', () => {
        expect(getWalletBalanceNotice({
            activeChainId: 56,
            walletTokenError: 'upstream failed',
            backendWalletTokens: [],
        })).toBe('Wallet balances could not be loaded.')

        expect(getWalletBalanceNotice({
            activeChainId: 56,
            walletTokenStale: true,
            backendWalletTokens: [{ chainId: 56 }],
            walletTokenFailedChainIds: [56],
        })).toBe('Showing previously loaded balances.')
    })
})

describe('getPrimaryActionPresentation', () => {
    const reviewAction = {
        type: 'swap',
        label: 'Review Gas Assisted Swap',
        enabled: true,
    }

    it('keeps the enter-amount action before Gas Assist has a positive input', () => {
        const enterAmountAction = {
            type: 'enter-amount',
            label: 'Enter an amount',
            enabled: false,
        }
        expect(getPrimaryActionPresentation({
            action: enterAmountAction,
            crossChainGasAssistDirect: true,
            crossChainGasAssistStatus: 'loading',
        })).toBe(enterAmountAction)
    })

    it('shows progress while a zero-BNB direct Gas Assist quote is loading', () => {
        expect(getPrimaryActionPresentation({
            action: reviewAction,
            crossChainGasAssistDirect: true,
            crossChainGasAssistStatus: 'loading',
        })).toEqual({
            type: 'gas-assist-loading',
            label: 'Preparing Gas Assist…',
            enabled: false,
            loading: true,
        })
    })

    it('preserves the normal action outside cross-chain Gas Assist loading', () => {
        expect(getPrimaryActionPresentation({
            action: reviewAction,
            crossChainGasAssistExpected: true,
            crossChainGasAssistStatus: 'success',
        })).toBe(reviewAction)
    })

    it('fails closed when zero-BNB direct Gas Assist is unavailable', () => {
        expect(getPrimaryActionPresentation({
            action: reviewAction,
            crossChainGasAssistDirect: true,
            crossChainGasAssistStatus: 'error',
        })).toEqual({
            type: 'gas-assist-unavailable',
            label: 'Gas Assist unavailable',
            enabled: false,
            loading: false,
        })
    })
})


describe('formatTokenDisplayAmount', () => {
    it('replaces a deceptive token symbol with the contract identity', () => {
        expect(formatTokenDisplayAmount('4900', {
            address: '0x00000000000000000000000000000000000000ff',
            symbol: 'USDС',
        })).toBe('4900 0x0000…00ff')
    })

    it('keeps a safe token symbol unchanged', () => {
        expect(formatTokenDisplayAmount('1.25', {
            address: '0x00000000000000000000000000000000000000ff',
            symbol: 'USDC',
        })).toBe('1.25 USDC')
    })

    it('does not label a malformed or absent raw quote limit as a token amount', () => {
        expect(formatTokenDisplayAmount(null, { symbol: 'CBBTC' })).toBeNull()
        expect(formatTokenDisplayAmount(undefined, { symbol: 'CBBTC' })).toBeNull()
    })
})


describe('same-chain review amount denomination', () => {
    const sellToken = { symbol: 'CBBTC', decimals: 8, address: '0x1111111111111111111111111111111111111111' }
    const buyToken = { symbol: 'ETH', decimals: 18, address: '0x2222222222222222222222222222222222222222' }

    it('displays actual CBBTC units rather than the $0.10 sell input', () => {
        const result = getSameChainReviewTokenAmounts({
            snapshot: { request: { mode: 'EXACT_INPUT', sellAmount: '100' } },
            selectedQuote: { sellAmount: '100', buyAmount: '44000000000000' },
            sellToken,
            buyToken,
        })
        expect(result).toEqual({
            sellAmount: '0.000001',
            buyAmount: '0.000044',
        })
        expect(result.sellAmount).not.toBe('0.10')
        expect(formatCompactRate(
            result.sellAmount, sellToken.symbol,
            result.buyAmount, buyToken.symbol,
        )).toBe('1 CBBTC = 44 ETH')
    })

    it('uses exact-output token units rather than the buy-side dollar value', () => {
        const result = getSameChainReviewTokenAmounts({
            snapshot: { request: { mode: 'EXACT_OUTPUT', buyAmount: '44000000000000' } },
            selectedQuote: {
                sellAmount: '100', maximumSellAmount: '103',
                buyAmount: '44000000000000',
            },
            sellToken,
            buyToken,
        })
        expect(result).toEqual({
            sellAmount: '0.00000103',
            buyAmount: '0.000044',
        })
    })

    it('preserves all token digits for small token amounts and does not use floating point', () => {
        const result = getSameChainReviewTokenAmounts({
            snapshot: { request: { mode: 'EXACT_INPUT', sellAmount: '1' } },
            selectedQuote: { buyAmount: '123456789012345' },
            sellToken: { ...sellToken, decimals: 18 },
            buyToken: { ...buyToken, decimals: 18 },
        })
        expect(result).toEqual({
            sellAmount: '0.000000000000000001',
            buyAmount: '0.000123456789012345',
        })
    })

    it('fails closed on missing, malformed, or unbound amount metadata', () => {
        expect(getSameChainReviewTokenAmounts({
            snapshot: { request: { mode: 'EXACT_INPUT', sellAmount: '0.1' } },
            selectedQuote: { buyAmount: '44000000000000' },
            sellToken, buyToken,
        })).toEqual({ sellAmount: null, buyAmount: '0.000044' })
        expect(getSameChainReviewTokenAmounts({
            snapshot: null,
            selectedQuote: { sellAmount: '100', buyAmount: '44000000000000' },
            sellToken, buyToken,
        })).toEqual({ sellAmount: null, buyAmount: null })
        expect(getSameChainReviewTokenAmounts({
            snapshot: { request: { mode: 'EXACT_OUTPUT', buyAmount: '44000000000000' } },
            selectedQuote: { buyAmount: '44000000000000' },
            sellToken, buyToken,
        })).toEqual({ sellAmount: null, buyAmount: '0.000044' })
    })
})

describe('retired Gas Assist surface', () => {
    it('does not read the removed nested legacy gasAssist controller state', () => {
        const viewModelSource = readFileSync('src/features/swap/model/swapViewModel.js', 'utf8')
        const dialogsSource = readFileSync('src/features/gas-assist/components/GasAssistDialogs.jsx', 'utf8')

        expect(viewModelSource).not.toContain('gasAssist.gasAssist')
        expect(dialogsSource).not.toContain('GasAssistApprovalDialog')
        expect(dialogsSource).toContain('GasAssistPrepaymentDialog')
    })
})


describe('network cost quote display data', () => {
    const native = { chainId: 1, address: '0x0000000000000000000000000000000000000000', isNative: true, priceUSD: null }
    const route = normalizeCrossChainRoute({ publicRouteId: 'route-1', sourceChainId: 1, destinationChainId: 8453, sourceGasEstimate: '180000' })
    it('uses quote gas before review and finds source native pricing when the wallet fallback has none', () => {
        const result = getNetworkFeeDisplayData({ chainId: 1, isCrossChain: true, route, nativeToken: native,
            availableTokens: [{ ...native, marketPriceUSD: '2600' }, { ...native, chainId: 8453, priceUSD: '9999' }] })
        expect(result).toEqual({ gasEstimate: 216000n, nativePriceUsd: '2600' })
    })
    it('replaces quote metadata with the current prepared RPC estimate, never another route estimate', () => {
        const options = { chainId: 1, isCrossChain: true, route, nativeToken: native,
            reviewedRoute: route, preparation: { sourceGasEstimate: '190000' } }
        expect(getNetworkFeeDisplayData(options).gasEstimate).toBe(190000n)
        expect(getNetworkFeeDisplayData({ ...options, reviewedRoute: { publicRouteId: 'old-route' } }).gasEstimate).toBe(216000n)
    })
    it('does not borrow a destination-native price or a different source-chain estimate', () => {
        expect(getNetworkFeeDisplayData({ chainId: 10, isCrossChain: true, route,
            nativeToken: native, buyToken: { ...native, chainId: 8453, priceUSD: '2600' } }))
            .toEqual({ gasEstimate: null, nativePriceUsd: null })
        expect(normalizeCrossChainRoute({ publicRouteId: 'route-1', sourceChainId: 1, destinationChainId: 8453, sourceGasEstimate: '-1' }).sourceGasEstimate).toBeNull()
    })
    it('preserves same-chain quote gas and rejects malformed gas instead of fabricating a cost', () => {
        expect(getNetworkFeeDisplayData({ chainId: 1, nativeToken: { ...native, priceUSD: '2600' }, gasEstimate: 100000n }))
            .toEqual({ gasEstimate: 100000n, nativePriceUsd: '2600' })
        expect(getNetworkFeeDisplayData({ chainId: 1, gasEstimate: 'invalid' }).gasEstimate).toBeNull()
    })
    it('uses the quote source-native price even when an unfunded wallet and fallback catalog have no price', () => {
        const pricedRoute = normalizeCrossChainRoute({ ...route, sourceNativePriceUsd: '2600.12' })
        expect(getNetworkFeeDisplayData({ chainId: 1, isCrossChain: true, route: pricedRoute, nativeToken: native }))
            .toEqual({ gasEstimate: 216000n, nativePriceUsd: '2600.12' })
        expect(getNetworkFeeDisplayData({ chainId: 10, isCrossChain: true, route: pricedRoute, nativeToken: native }))
            .toEqual({ gasEstimate: null, nativePriceUsd: null })
    })

})
