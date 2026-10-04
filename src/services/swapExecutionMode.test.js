import { getAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import {
    CROSS_CHAIN,
    deriveRoutingMode,
    deriveSwapExecution,
    getSwapExecutionMessage,
    PREPAID_SPONSORSHIP_MODE,
    SAME_CHAIN_GAS_ASSIST,
    SAME_CHAIN_STANDARD,
} from './swapExecutionMode.js'

const sellToken = { chainId: 56, address: '0x0000000000000000000000000000000000000001', decimals: 18, isNative: false }
const buyToken = { address: '0x0000000000000000000000000000000000000002', decimals: 6, isNative: false }
const base = {
    isConnected: true,
    walletAddress: '0x0000000000000000000000000000000000000003',
    chainId: 56,
    nativeBalanceStatus: 'success',
    nativeBalance: 0n,
    sellToken,
    buyToken,
    sellAmount: '1000000',
    gasAssistConfig: { enabled: true, chainId: 56 },
    gasAssistConfigStatus: 'success',
    minimumNativeBalance: 100n,
}

describe('swap execution mode', () => {
    it('selects standard, assisted, and cross-chain routing before providers run', () => {
        expect(deriveRoutingMode({ sellChainId: 1, buyChainId: 1 }))
            .toBe(SAME_CHAIN_STANDARD)
        expect(deriveRoutingMode({ sellChainId: 56, buyChainId: 56, gasAssistPreferred: true }))
            .toBe(SAME_CHAIN_GAS_ASSIST)
        expect(deriveRoutingMode({ sellChainId: 56, buyChainId: 8453, gasAssistPreferred: true }))
            .toBe(CROSS_CHAIN)
    })

    it.each(['idle', 'loading'])('issues no quote while native balance is %s', (nativeBalanceStatus) => {
        expect(deriveSwapExecution({ ...base, nativeBalanceStatus }).mode).toBeNull()
    })

    it('fails closed on native balance errors', () => {
        expect(deriveSwapExecution({ ...base, nativeBalanceStatus: 'error', nativeBalance: null })).toMatchObject({
            mode: null,
            reason: 'native-balance-error',
        })
    })

    it('selects prepaid Gas Assist when BNB is zero or below the configured normal-gas reserve', () => {
        expect(deriveSwapExecution(base)).toEqual({ mode: PREPAID_SPONSORSHIP_MODE, reason: 'insufficient-native-balance' })
        expect(deriveSwapExecution({ ...base, nativeBalance: 99n })).toEqual({ mode: PREPAID_SPONSORSHIP_MODE, reason: 'insufficient-native-balance' })
        expect(deriveSwapExecution({ ...base, nativeBalance: 100n })).toEqual({ mode: 'normal', reason: null })
    })

    it('does not enter prepaid Gas Assist on the wrong chain or for a native sell token', () => {
        expect(deriveSwapExecution({ ...base, chainId: 1 })).toMatchObject({ mode: null, reason: 'wrong-chain' })
        expect(deriveSwapExecution({ ...base, sellToken: { ...sellToken, isNative: true } })).toMatchObject({ mode: null, reason: 'native-sell-token' })
    })

    it('keeps low-BNB swaps in the assisted lane while sponsorship config loads, errors, or is disabled', () => {
        expect(deriveSwapExecution({ ...base, gasAssistConfigStatus: 'loading', gasAssistConfig: null })).toEqual({
            mode: PREPAID_SPONSORSHIP_MODE,
            reason: 'gas-assist-config-loading',
        })
        expect(deriveSwapExecution({ ...base, gasAssistConfigStatus: 'error', gasAssistConfig: null })).toEqual({
            mode: PREPAID_SPONSORSHIP_MODE,
            reason: 'gas-assist-config-error',
        })
        expect(deriveSwapExecution({ ...base, gasAssistConfig: { enabled: false } })).toEqual({
            mode: PREPAID_SPONSORSHIP_MODE,
            reason: 'gas-assist-disabled',
        })

        expect(getSwapExecutionMessage('gas-assist-config-loading'))
            .toBe('Not enough native gas for normal gas. Checking Gas Assist availability…')
        expect(getSwapExecutionMessage('gas-assist-config-error'))
            .toBe('Not enough native gas for normal gas. Gas Assist availability could not be checked.')
        expect(getSwapExecutionMessage('gas-assist-disabled'))
            .toBe('Not enough native gas for normal gas. Gas Assist is currently unavailable.')
    })

    it('accepts XAUT-like metadata without symbol or frontend allowlist checks', () => {
        const xaut = {
            address: getAddress('0x68749665ff8d2d112fa859aa293f07a622782f38'),
            symbol: 'XAUT',
            decimals: 18,
            isNative: false,
        }
        const result = deriveSwapExecution({ ...base, sellToken: xaut })
        expect(result).toEqual({ mode: PREPAID_SPONSORSHIP_MODE, reason: 'insufficient-native-balance' })
        expect(xaut.symbol).toBe('XAUT')
    })

    it.each([
        ['USDC', '0x0000000000000000000000000000000000000011'],
        ['BTCB', '0x0000000000000000000000000000000000000012'],
        ['native BNB', '0x0000000000000000000000000000000000000000'],
    ])('preserves the selected %s output', (_symbol, address) => {
        const selectedBuy = { ...buyToken, address }
        expect(deriveSwapExecution({ ...base, buyToken: selectedBuy }).mode).toBe(PREPAID_SPONSORSHIP_MODE)
        expect(selectedBuy.address).toBe(address)
    })
})
