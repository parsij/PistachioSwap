import { encodeFunctionData } from 'viem'
import { describe, expect, it } from 'vitest'

import {
    classifyReceiptHistoryRow,
    KNOWN_PISTACHIO_BSC_CONTRACT_ADDRESSES,
} from './walletHistoryClassifier.js'

const wallet = '0x880c39159919700166e4612d4b7aa344fc21cd6f'
const other = '0x0000000000000000000000000000000000000011'
const tokenA = '0x00000000000000000000000000000000000000a1'
const tokenB = '0x00000000000000000000000000000000000000b1'
const hash = `0x${'12'.repeat(32)}`

function transfer({ token, from, to, value, symbol = 'TKN', decimals = 6 }) {
    return {
        address: token,
        from_address: from,
        to_address: to,
        value: String(value),
        value_formatted: (Number(value) / (10 ** decimals)).toString(),
        token_symbol: symbol,
        token_decimals: decimals,
    }
}

function row(overrides = {}) {
    return {
        hash,
        from_address: wallet,
        to_address: other,
        input: '0x',
        value: '0',
        block_number: '123',
        block_timestamp: '2026-09-06T12:00:00.000Z',
        receipt_status: '1',
        authorization_list: [],
        erc20_transfers: [],
        native_transfers: [],
        category: 'contract interaction',
        provider: 'alchemy-browser',
        swap_evidence: false,
        ...overrides,
    }
}

const gasAssistAbi = [{
    type: 'function',
    name: 'executeAtomicSwap',
    stateMutability: 'payable',
    inputs: [
        { name: 'treasury', type: 'address' },
        { name: 'paymentToken', type: 'address' },
        { name: 'feeAmount', type: 'uint256' },
        { name: 'sellToken', type: 'address' },
        { name: 'swapAmount', type: 'uint256' },
        { name: 'buyToken', type: 'address' },
        { name: 'router', type: 'address' },
        { name: 'swapCalldata', type: 'bytes' },
        { name: 'minOut', type: 'uint256' },
    ],
    outputs: [],
}]

describe('browser wallet-history classifier', () => {
    it('classifies a receipt-backed normal swap', () => {
        const activity = classifyReceiptHistoryRow(56, wallet, row({
            swap_evidence: true,
            erc20_transfers: [
                transfer({ token: tokenA, from: wallet, to: other, value: 2_000_000, symbol: 'USDC' }),
                transfer({ token: tokenB, from: other, to: wallet, value: 3_000_000, symbol: 'BUY' }),
            ],
        }))
        expect(activity).toMatchObject({
            type: 'swapped',
            sellAmount: '2',
            buyAmount: '3',
            source: 'remote',
        })
    })

    it('uses the encoded Gas Assist principal instead of a same-token fee transfer', () => {
        const executor = KNOWN_PISTACHIO_BSC_CONTRACT_ADDRESSES[1]
        const input = encodeFunctionData({
            abi: gasAssistAbi,
            functionName: 'executeAtomicSwap',
            args: [
                other,
                tokenA,
                100_000n,
                tokenA,
                1_000_000n,
                tokenB,
                other,
                '0x1234',
                1n,
            ],
        })
        const activity = classifyReceiptHistoryRow(56, wallet, row({
            to_address: wallet,
            input,
            authorization_list: [{ address: executor }],
            erc20_transfers: [
                transfer({ token: tokenA, from: wallet, to: other, value: 100_000, symbol: 'USDC' }),
                transfer({ token: tokenA, from: wallet, to: other, value: 1_000_000, symbol: 'USDC' }),
                transfer({ token: tokenB, from: other, to: wallet, value: 2_000_000, symbol: 'BUY' }),
            ],
        }))
        expect(activity).toMatchObject({
            type: 'swapped',
            sellAmount: '1',
            buyAmount: '2',
            provider: 'pistachio-gas-assist',
            detectedContract: executor,
        })
    })

    it('keeps a plain wallet-initiated token transfer as sent', () => {
        const activity = classifyReceiptHistoryRow(56, wallet, row({
            erc20_transfers: [
                transfer({ token: tokenA, from: wallet, to: other, value: 5_000_000, symbol: 'USDC' }),
            ],
        }))
        expect(activity).toMatchObject({ type: 'sent', amount: '5' })
    })

    it('does not treat a forged outbound token log as a wallet send', () => {
        const attacker = '0x0000000000000000000000000000000000000099'
        const activity = classifyReceiptHistoryRow(56, wallet, row({
            from_address: attacker,
            to_address: tokenA,
            erc20_transfers: [
                transfer({ token: tokenA, from: wallet, to: other, value: 5_000_000 }),
            ],
        }))
        expect(activity).toBeNull()
    })

    it('classifies a direct receive', () => {
        const activity = classifyReceiptHistoryRow(56, wallet, row({
            from_address: other,
            to_address: tokenA,
            erc20_transfers: [
                transfer({ token: tokenA, from: other, to: wallet, value: 7_000_000, symbol: 'USDC' }),
            ],
        }))
        expect(activity).toMatchObject({ type: 'received', amount: '7', sender: other })
    })

    it('recognizes approve calldata before generic contract classification', () => {
        const input = encodeFunctionData({
            abi: [{
                type: 'function',
                name: 'approve',
                stateMutability: 'nonpayable',
                inputs: [
                    { name: 'spender', type: 'address' },
                    { name: 'amount', type: 'uint256' },
                ],
                outputs: [{ name: '', type: 'bool' }],
            }],
            functionName: 'approve',
            args: [other, 123n],
        })
        const activity = classifyReceiptHistoryRow(56, wallet, row({
            to_address: tokenA,
            input,
        }))
        expect(activity).toMatchObject({ type: 'approved', recipient: other })
    })

    it('does not display a failed transaction as a successful activity', () => {
        expect(classifyReceiptHistoryRow(56, wallet, row({ receipt_status: '0' }))).toBeNull()
    })
})
