import { describe, expect, it } from 'vitest'

import {
    estimateCrossChainGasAssistInput,
    previewCoversNativeGas,
} from './crossChainGasAssist.js'

describe('cross-chain Gas Assist top-up sizing', () => {
    it('reserves a conservative token slice while leaving bridge input', () => {
        const amount = estimateCrossChainGasAssistInput({
            totalInputRaw: '100000000', tokenDecimals: 6, tokenPriceUsd: '1',
            sourceGasUsd: '0.04', requiredNativeGasWei: '80000000000000',
            nativeBalanceWei: '0', fixedFeeUsd: '0.067', platformFeeBps: 300,
        })
        expect(BigInt(amount)).toBeGreaterThan(200_000n)
        expect(BigInt(amount)).toBeLessThan(1_000_000n)
    })

    it('does not offer a top-up without trusted pricing or when it would consume the trade', () => {
        expect(estimateCrossChainGasAssistInput({
            totalInputRaw: '100', tokenDecimals: 18, tokenPriceUsd: null,
            sourceGasUsd: '0.04', requiredNativeGasWei: '10', nativeBalanceWei: '0',
            fixedFeeUsd: '0.067', platformFeeBps: 300,
        })).toBeNull()
        expect(estimateCrossChainGasAssistInput({
            totalInputRaw: '1', tokenDecimals: 6, tokenPriceUsd: '1',
            sourceGasUsd: '0.04', requiredNativeGasWei: '10', nativeBalanceWei: '0',
            fixedFeeUsd: '0.067', platformFeeBps: 300,
        })).toBeNull()
    })

    it('requires previewed BNB output to cover the exact shortfall', () => {
        expect(previewCoversNativeGas({
            preview: { minimumOutputRaw: '100' }, requiredNativeGasWei: '100', nativeBalanceWei: '20',
        })).toBe(true)
        expect(previewCoversNativeGas({
            preview: { minimumOutputRaw: '99' }, requiredNativeGasWei: '100', nativeBalanceWei: '20',
        })).toBe(false)
    })
})
