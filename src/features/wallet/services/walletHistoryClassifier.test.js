import { encodeFunctionData } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    buildReceiptHistoryRow,
    classifyReceiptHistoryRow,
    ENTRY_POINT_V08_ADDRESS,
    KNOWN_PISTACHIO_BSC_CONTRACT_ADDRESSES,
    walletHistoryClassifierInternals,
} from './walletHistoryClassifier.js'

const wallet = '0x880c39159919700166e4612d4b7aa344fc21cd6f'
const other = '0x0000000000000000000000000000000000000011'
const tokenA = '0x00000000000000000000000000000000000000a1'
const tokenB = '0x00000000000000000000000000000000000000b1'
const hash = `0x${'12'.repeat(32)}`
const paymaster = '0xbf7d14999219fae39faf7a80574ddba39839f5c1'

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

const gasAssistCrossChainAbi = [{
    type: 'function',
    name: 'executeAtomicCrossChain',
    stateMutability: 'payable',
    inputs: [
        { name: 'treasury', type: 'address' },
        { name: 'paymentToken', type: 'address' },
        { name: 'feeAmount', type: 'uint256' },
        { name: 'sellToken', type: 'address' },
        { name: 'swapAmount', type: 'uint256' },
        { name: 'destinationChainId', type: 'uint256' },
        { name: 'buyToken', type: 'address' },
        { name: 'allowanceTarget', type: 'address' },
        { name: 'router', type: 'address' },
        { name: 'swapCalldata', type: 'bytes' },
        { name: 'minOut', type: 'uint256' },
    ],
    outputs: [],
}]

describe('browser wallet-history classifier', () => {
    beforeEach(() => {
        vi.stubEnv('VITE_PISTACHIO_PAYMASTER_ADDRESS', paymaster)
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

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

    it('classifies a successful cross-chain executor call as a swap from its exact source flow', () => {
        const executor = KNOWN_PISTACHIO_BSC_CONTRACT_ADDRESSES[2]
        const input = encodeFunctionData({
            abi: gasAssistCrossChainAbi,
            functionName: 'executeAtomicCrossChain',
            args: [
                other,
                tokenA,
                100_000n,
                tokenA,
                1_000_000n,
                137n,
                tokenB,
                other,
                other,
                '0x1234',
                500_000n,
            ],
        })
        const activity = classifyReceiptHistoryRow(56, wallet, row({
            to_address: wallet,
            input,
            authorization_list: [{ address: executor }],
            erc20_transfers: [
                transfer({ token: tokenA, from: wallet, to: other, value: 100_000, symbol: 'USDC' }),
                transfer({ token: tokenA, from: wallet, to: other, value: 1_000_000, symbol: 'USDC' }),
            ],
        }))

        expect(activity).toMatchObject({
            type: 'swapped',
            chainId: 56,
            destinationChainId: 137,
            sellAmount: '1',
            buyAmount: null,
            provider: 'pistachio-gas-assist-cross-chain',
            detectedContract: executor,
        })
        expect(activity.buyToken).toMatchObject({ address: tokenB })
    })

    it('does not call a cross-chain executor interaction a swap without the exact reviewed sell flow', () => {
        const executor = KNOWN_PISTACHIO_BSC_CONTRACT_ADDRESSES[2]
        const input = encodeFunctionData({
            abi: gasAssistCrossChainAbi,
            functionName: 'executeAtomicCrossChain',
            args: [
                other,
                tokenA,
                100_000n,
                tokenA,
                1_000_000n,
                137n,
                tokenB,
                other,
                other,
                '0x1234',
                500_000n,
            ],
        })
        const activity = classifyReceiptHistoryRow(56, wallet, row({
            to_address: wallet,
            input,
            authorization_list: [{ address: executor }],
            erc20_transfers: [
                transfer({ token: tokenA, from: wallet, to: other, value: 100_000, symbol: 'USDC' }),
            ],
        }))

        expect(activity).toMatchObject({ type: 'sent' })
    })

    it('classifies a self-hosted Gas Assist UserOperation as one swap across devices', () => {
        const bundler = '0x00000000000000000000000000000000000000f1'
        const activity = classifyReceiptHistoryRow(56, wallet, row({
            from_address: bundler,
            to_address: ENTRY_POINT_V08_ADDRESS,
            swap_evidence: true,
            user_operation_senders: [wallet],
            user_operation_paymasters: [paymaster],
            erc20_transfers: [
                transfer({ token: tokenA, from: wallet, to: other, value: 2_000_000, symbol: 'USDC' }),
                transfer({ token: tokenB, from: other, to: wallet, value: 3_000_000, symbol: 'ETH' }),
            ],
        }))

        expect(activity).toMatchObject({
            type: 'swapped',
            sellAmount: '2',
            buyAmount: '3',
            provider: 'pistachio-self-hosted-gas-assist',
            source: 'remote',
        })
    })

    it('extracts the wallet sender from an EntryPoint UserOperationEvent receipt', () => {
        const senderTopic = `0x${'0'.repeat(24)}${wallet.slice(2)}`
        const rowValue = buildReceiptHistoryRow({
            chainId: 56,
            walletAddress: wallet,
            transaction: {
                hash,
                from: other,
                to: ENTRY_POINT_V08_ADDRESS,
                input: '0x1234',
                value: '0x0',
                blockNumber: '0x7b',
                authorizationList: [],
            },
            receipt: {
                status: '0x1',
                logs: [{
                    address: ENTRY_POINT_V08_ADDRESS,
                    topics: [
                        walletHistoryClassifierInternals.USER_OPERATION_EVENT,
                        `0x${'11'.repeat(32)}`,
                        senderTopic,
                        `0x${'0'.repeat(24)}${other.slice(2)}`,
                    ],
                    data: '0x',
                }],
            },
            indexedTransfers: [],
        })

        expect(rowValue.user_operation_senders).toEqual([wallet])
        expect(rowValue.user_operation_paymasters).toEqual([other])
    })

    it('builds wallet-scoped native flow from indexed internal BNB transfers', () => {
        const rowValue = buildReceiptHistoryRow({
            chainId: 56,
            walletAddress: wallet,
            transaction: {
                hash,
                from: other,
                to: ENTRY_POINT_V08_ADDRESS,
                input: '0x1234',
                value: '0x0',
                blockNumber: '0x7b',
                authorizationList: [],
            },
            receipt: {
                status: '0x1',
                logs: [],
            },
            indexedTransfers: [{
                category: 'internal',
                from: wallet,
                to: other,
                value: '0.25',
                rawContract: {
                    address: null,
                    value: '0x3635c9adc5dea000',
                    decimal: '0x12',
                },
                metadata: {
                    blockTimestamp: '2026-09-06T12:00:00.000Z',
                },
            }],
        })

        expect(rowValue.native_transfers).toEqual([{
            from_address: wallet,
            to_address: other,
            value: '250000000000000000',
            value_formatted: '0.25',
        }])
    })

    it('classifies a sponsored BNB-to-token UserOperation as one swap without relying on pool event signatures', () => {
        const bundler = '0x00000000000000000000000000000000000000f1'
        const activity = classifyReceiptHistoryRow(56, wallet, row({
            from_address: bundler,
            to_address: ENTRY_POINT_V08_ADDRESS,
            swap_evidence: false,
            user_operation_senders: [wallet],
            user_operation_paymasters: [paymaster],
            native_transfers: [{
                from_address: wallet,
                to_address: other,
                value: '250000000000000000',
                value_formatted: '0.25',
            }],
            erc20_transfers: [
                transfer({ token: tokenB, from: other, to: wallet, value: 3_000_000, symbol: 'BUY' }),
            ],
        }))

        expect(activity).toMatchObject({
            type: 'swapped',
            sellAmount: '0.25',
            buyAmount: '3',
            provider: 'pistachio-self-hosted-gas-assist',
        })
        expect(activity.sellToken).toMatchObject({ isNative: true, symbol: 'BNB' })
    })

    it('classifies a sponsored token-to-BNB UserOperation as one swap', () => {
        const bundler = '0x00000000000000000000000000000000000000f1'
        const activity = classifyReceiptHistoryRow(56, wallet, row({
            from_address: bundler,
            to_address: ENTRY_POINT_V08_ADDRESS,
            swap_evidence: false,
            user_operation_senders: [wallet],
            user_operation_paymasters: [paymaster],
            erc20_transfers: [
                transfer({ token: tokenA, from: wallet, to: other, value: 2_000_000, symbol: 'SELL' }),
            ],
            native_transfers: [{
                from_address: other,
                to_address: wallet,
                value: '125000000000000000',
                value_formatted: '0.125',
            }],
        }))

        expect(activity).toMatchObject({
            type: 'swapped',
            sellAmount: '2',
            buyAmount: '0.125',
            provider: 'pistachio-self-hosted-gas-assist',
        })
        expect(activity.buyToken).toMatchObject({ isNative: true, symbol: 'BNB' })
    })

    it('does not label an unrelated ERC-4337 UserOperation as Pistachio Gas Assist', () => {
        const bundler = '0x00000000000000000000000000000000000000f1'
        const unrelatedPaymaster = '0x00000000000000000000000000000000000000f2'
        const activity = classifyReceiptHistoryRow(56, wallet, row({
            from_address: bundler,
            to_address: ENTRY_POINT_V08_ADDRESS,
            swap_evidence: false,
            user_operation_senders: [wallet],
            user_operation_paymasters: [unrelatedPaymaster],
            erc20_transfers: [
                transfer({ token: tokenA, from: wallet, to: other, value: 2_000_000, symbol: 'SELL' }),
                transfer({ token: tokenB, from: other, to: wallet, value: 3_000_000, symbol: 'BUY' }),
            ],
        }))

        expect(activity).toBeNull()
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
