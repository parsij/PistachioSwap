import {
    encodeAbiParameters,
    encodeEventTopics,
    parseAbiParameters,
    type Address,
} from 'viem'
import { describe, expect, it } from 'vitest'

import {
    transferEventAbi,
    verifyExactTransferReceipt,
} from '../src/gas-assist/prepaid/chain-client.js'

const wallet = '0x1111111111111111111111111111111111111111' as Address
const token = '0x2222222222222222222222222222222222222222' as Address
const treasury = '0x3333333333333333333333333333333333333333' as Address

function receipt(amount: bigint) {
    return {
        status: 'success',
        logs: [{
            address: token,
            topics: encodeEventTopics({
                abi: transferEventAbi,
                eventName: 'Transfer',
                args: { from: wallet, to: treasury },
            }),
            data: encodeAbiParameters(parseAbiParameters('uint256'), [amount]),
        }],
    }
}

describe('MegaFuel exact fee payment confirmation', () => {
    it('accepts only the exact backend-calculated raw amount', () => {
        expect(verifyExactTransferReceipt({
            receipt: receipt(1_000n),
            transactionFrom: wallet,
            transactionTo: token,
            wallet,
            token,
            treasury,
            requiredAmount: 1_000n,
        })).toBe(1_000n)
    })

    it.each([
        ['underpayment', 999n],
        ['overpayment', 1_001n],
        ['dust payment', 1n],
    ])('rejects %s before authorizing the next sponsored action', (_label, amount) => {
        expect(() => verifyExactTransferReceipt({
            receipt: receipt(amount),
            transactionFrom: wallet,
            transactionTo: token,
            wallet,
            token,
            treasury,
            requiredAmount: 1_000n,
        })).toThrow(/exact required payment/)
    })
})
