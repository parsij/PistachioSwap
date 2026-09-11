import { describe, expect, it } from 'vitest'
import { encodeFunctionData, parseAbi } from 'viem'

import {
    GAS_ASSIST_CROSS_CHAIN_EXECUTOR_ADDRESS,
    walletActivityInternals,
} from '../src/modules/wallet-activity.js'

const crossChainExecutorAbi = parseAbi([
    'function executeAtomicCrossChain(address treasury,address paymentToken,uint256 feeAmount,address sellToken,uint256 swapAmount,uint256 destinationChainId,address buyToken,address allowanceTarget,address router,bytes swapCalldata,uint256 minOut,uint256 authorizationNonce,uint256 authorizationDeadline,bytes authorizationSignature)',
])

describe('cross-chain Gas Assist wallet activity', () => {
    it('classifies the BSC source transaction as a swap to the destination token', () => {
        const wallet = '0x880c39159919700166e4612d4b7aa344fc21cd6f'
        const sellToken = '0x45e51bc23d592eb2dba86da3985299f7895d66ba'
        const buyToken = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
        const treasury = '0x1111111111111111111111111111111111111111'
        const allowanceTarget = '0x2222222222222222222222222222222222222222'
        const router = '0x3333333333333333333333333333333333333333'
        const swapAmount = 137_938_000_000_000_000n
        const feeAmount = 20_000_000_000_000_000n

        const input = encodeFunctionData({
            abi: crossChainExecutorAbi,
            functionName: 'executeAtomicCrossChain',
            args: [
                treasury,
                sellToken,
                feeAmount,
                sellToken,
                swapAmount,
                8453n,
                buyToken,
                allowanceTarget,
                router,
                '0x12345678',
                1n,
                1n,
                2_000_000_000n,
                '0x1234',
            ],
        })

        const activity = walletActivityInternals.normalizeMoralisActivity(56, wallet, {
            hash: `0x${'ab'.repeat(32)}`,
            receipt_status: '1',
            block_timestamp: '2026-09-10T17:37:00.000Z',
            from_address: wallet,
            to_address: wallet,
            input,
            authorization_list: [{ address: GAS_ASSIST_CROSS_CHAIN_EXECUTOR_ADDRESS }],
            erc20_transfers: [
                {
                    address: sellToken,
                    token_address: sellToken,
                    token_symbol: 'USDD',
                    token_name: 'USDD',
                    token_decimals: '18',
                    possible_spam: false,
                    from_address: wallet,
                    to_address: treasury,
                    direction: 'outgoing',
                    value: feeAmount.toString(),
                    value_formatted: '0.02',
                },
                {
                    address: sellToken,
                    token_address: sellToken,
                    token_symbol: 'USDD',
                    token_name: 'USDD',
                    token_decimals: '18',
                    possible_spam: false,
                    from_address: wallet,
                    to_address: router,
                    direction: 'outgoing',
                    value: swapAmount.toString(),
                    value_formatted: '0.137938',
                },
            ],
            native_transfers: [],
        })

        expect(activity).toMatchObject({
            type: 'swapped',
            chainId: 56,
            destinationChainId: 8453,
            sellAmount: '0.137938',
            buyAmount: null,
            provider: 'pistachio-gas-assist',
            detectedContract: GAS_ASSIST_CROSS_CHAIN_EXECUTOR_ADDRESS,
            sellToken: {
                address: sellToken,
                symbol: 'USDD',
            },
            buyToken: {
                address: buyToken,
            },
        })
    })
})
