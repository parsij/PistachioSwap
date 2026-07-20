import { getAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import {
    CROSS_CHAIN,
    deriveRoutingMode,
    deriveSwapExecution,
    getSwapExecutionMessage,
    SAME_CHAIN_GASLESS_OR_ASSISTED,
    SAME_CHAIN_STANDARD,
} from './swapExecutionMode.js'

const sellToken = { address: '0x0000000000000000000000000000000000000001', decimals: 18, isNative: false }
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
    gasAssistConfig: { enabled: true, mode: 'zero-x-gasless' },
    gasAssistConfigStatus: 'success',
}

describe('swap execution mode', () => {
    it('selects standard, assisted, and cross-chain routing before providers run', () => {
        expect(deriveRoutingMode({ sellChainId: 1, buyChainId: 1 }))
            .toBe(SAME_CHAIN_STANDARD)
        expect(deriveRoutingMode({ sellChainId: 56, buyChainId: 56, gasAssistPreferred: true }))
            .toBe(SAME_CHAIN_GASLESS_OR_ASSISTED)
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

    it('selects Gasless only for an eligible zero-BNB wallet', () => {
        expect(deriveSwapExecution(base).mode).toBe('zero-x-gasless')
        expect(deriveSwapExecution({ ...base, nativeBalance: 1n }).mode).toBe('normal')
    })

    it('does not enter Gasless on the wrong chain, native sell, or disabled config', () => {
        expect(deriveSwapExecution({ ...base, chainId: 1 })).toMatchObject({ mode: null, reason: 'wrong-chain' })
        expect(deriveSwapExecution({ ...base, sellToken: { ...sellToken, isNative: true } })).toMatchObject({ mode: null, reason: 'native-sell-token' })
        expect(deriveSwapExecution({ ...base, gasAssistConfig: { enabled: false, mode: 'disabled' } })).toMatchObject({ mode: null, reason: 'gas-assist-disabled' })
    })

    it('distinguishes config loading, errors, and disabled responses', () => {
        expect(deriveSwapExecution({ ...base, gasAssistConfigStatus: 'loading', gasAssistConfig: null }).reason)
            .toBe('gas-assist-config-loading')
        expect(deriveSwapExecution({ ...base, gasAssistConfigStatus: 'error', gasAssistConfig: null }).reason)
            .toBe('gas-assist-config-error')
        expect(getSwapExecutionMessage('gas-assist-config-loading')).toBe('Checking Gas Assist availability…')
        expect(getSwapExecutionMessage('gas-assist-config-error')).toBe('Gas Assist configuration could not be loaded.')
        expect(getSwapExecutionMessage('gas-assist-disabled')).toBe('Gas Assist is currently disabled.')
    })

    it('accepts XAUT-like metadata without symbol or allowlist checks', () => {
        const xaut = {
            address: getAddress('0x68749665ff8d2d112fa859aa293f07a622782f38'),
            symbol: 'XAUT',
            decimals: 18,
            isNative: false,
        }
        const result = deriveSwapExecution({ ...base, sellToken: xaut })
        expect(result).toEqual({ mode: 'zero-x-gasless', reason: null })
        expect(xaut.symbol).toBe('XAUT')
    })

    it.each([
        ['USDC', '0x0000000000000000000000000000000000000011'],
        ['BTCB', '0x0000000000000000000000000000000000000012'],
        ['native BNB', '0x0000000000000000000000000000000000000000'],
    ])('preserves the selected %s output', (_symbol, address) => {
        const selectedBuy = { ...buyToken, address }
        expect(deriveSwapExecution({ ...base, buyToken: selectedBuy }).mode).toBe('zero-x-gasless')
        expect(selectedBuy.address).toBe(address)
    })
})
