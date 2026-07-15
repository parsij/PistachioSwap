import { parseEther } from 'viem'
import { describe, expect, it } from 'vitest'

import {
    createTransferPlan,
    isTransferRejectedError,
} from './transfers.js'

const account = '0x0000000000000000000000000000000000000001'
const recipient = '0x0000000000000000000000000000000000000002'
const native = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000000',
    decimals: 18,
}
const erc20 = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000003',
    decimals: 6,
    rawBalance: '5000000',
}

describe('send transaction plans', () => {
    it('uses a normal native value transaction', () => {
        const plan = createTransferPlan({
            account,
            chainId: 56,
            recipient,
            amount: '0.25',
            token: native,
            nativeBalanceWei: parseEther('1'),
            estimatedFeeWei: parseEther('0.001'),
        })
        expect(plan.kind).toBe('native')
        expect(plan.request).toMatchObject({ to: recipient, value: parseEther('0.25') })
        expect(plan.request.data).toBeUndefined()
    })

    it('uses the standard ERC-20 transfer call with exact units', () => {
        const plan = createTransferPlan({
            account,
            chainId: 56,
            recipient,
            amount: '1.234567',
            token: erc20,
            nativeBalanceWei: parseEther('1'),
            estimatedFeeWei: parseEther('0.001'),
        })
        expect(plan.kind).toBe('erc20')
        expect(plan.request.functionName).toBe('transfer')
        expect(plan.request.args).toEqual([recipient, 1_234_567n])
    })

    it('prevents a native max send that does not reserve the estimated fee', () => {
        expect(() => createTransferPlan({
            account,
            chainId: 56,
            recipient,
            amount: '1',
            token: native,
            nativeBalanceWei: parseEther('1'),
            estimatedFeeWei: parseEther('0.001'),
        })).toThrow('Insufficient BNB')
    })

    it('blocks the wrong chain and identifies wallet rejection separately', () => {
        expect(() => createTransferPlan({
            account,
            chainId: 1,
            recipient,
            amount: '1',
            token: erc20,
            nativeBalanceWei: parseEther('1'),
        })).toThrow('Switch to BNB Smart Chain')
        expect(isTransferRejectedError({ code: 4001 })).toBe(true)
        expect(isTransferRejectedError(new Error('rpc failed'))).toBe(false)
    })
})
