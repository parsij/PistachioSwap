import { parseEther, parseUnits } from 'viem'
import { describe, expect, it } from 'vitest'

import {
    getBootstrapNativeGasReserveWei,
    getNativeSpendableWei,
    getQuoteEstimatedNativeFeeWei,
    getSpendableTokenAmount,
    isNativeBnbToken,
    isNativeEvmToken,
    multiplyAmountByPercent,
} from './balances.js'

const native = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000000',
    decimals: 18,
    balance: '0.00534963167546908',
}

const erc20 = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000001',
    decimals: 6,
    rawBalance: '123456789',
    balance: '123.456789',
}

describe('exact spendable balance math', () => {
    it('recognizes native tokens on any EVM chain without treating them as BNB', () => {
        const nativeEth = {
            ...native,
            chainId: 1,
            symbol: 'ETH',
            isNative: true,
        }
        expect(isNativeEvmToken(nativeEth)).toBe(true)
        expect(isNativeBnbToken(nativeEth)).toBe(false)
    })

    it('fills an ERC-20 complete exact formatted balance', () => {
        expect(getSpendableTokenAmount({ token: erc20 })).toBe('123.456789')
    })

    it('reserves configured gas from native BNB', () => {
        expect(getSpendableTokenAmount({
            token: native,
            nativeBalanceWei: parseEther(native.balance),
            fallbackReserveWei: parseEther('0.001'),
        })).toBe('0.00434963167546908')
    })

    it('uses spendable balance for percentage buttons', () => {
        expect(multiplyAmountByPercent('0.004', 18, 25)).toBe('0.001')
        expect(multiplyAmountByPercent('123.456789', 6, 50)).toBe('61.728394')
    })

    it('uses estimated fee plus a safety margin and never goes negative', () => {
        expect(getNativeSpendableWei({
            balanceWei: parseEther('1'),
            estimatedFeeWei: parseEther('0.01'),
        })).toBe(parseEther('0.9875'))
        expect(getNativeSpendableWei({
            balanceWei: parseUnits('0.001', 18),
            fallbackReserveWei: parseUnits('0.001', 18),
        })).toBe(0n)
    })

    it('converts a provider gas USD estimate into native wei on low-fee EVM chains', () => {
        const fee = getQuoteEstimatedNativeFeeWei({
            quote: {
                selectedQuote: {
                    estimatedGas: '150000',
                    estimatedGasUsd: '0.003',
                    transaction: {
                        gas: '150000',
                    },
                },
            },
            nativeToken: {
                decimals: 18,
                trustedPriceUSD: '3000',
                priceConfidence: 'trusted',
            },
        })

        expect(fee).toBe(1_000_000_000_000n)
    })

    it('reads cross-chain source gas in native units independently of destination fees', () => {
        expect(getQuoteEstimatedNativeFeeWei({
            quote: { costs: { sourceGasNative: '0.000001', destinationGasUsd: '100', routeCostUsd: '999' } },
            nativeToken: { decimals: 18 },
        })).toBe(1_000_000_000_000n)
    })

    it('prefers direct EIP-1559 gas math when maxFeePerGas is available', () => {
        const fee = getQuoteEstimatedNativeFeeWei({
            quote: {
                selectedQuote: {
                    transaction: {
                        gas: '100000',
                        maxFeePerGas: '2000000000',
                    },
                    estimatedGasUsd: '999',
                },
            },
            nativeToken: {
                decimals: 18,
                trustedPriceUSD: '3000',
                priceConfidence: 'trusted',
            },
        })

        expect(fee).toBe(200_000_000_000_000n)
    })

    it('caps only the pre-quote bootstrap reserve for a small native balance', () => {
        expect(getBootstrapNativeGasReserveWei({
            balanceWei: 83_000_000_000_000n,
            fallbackReserveWei: 50_000_000_000_000n,
        })).toBe(8_300_000_000_000n)
    })
})
