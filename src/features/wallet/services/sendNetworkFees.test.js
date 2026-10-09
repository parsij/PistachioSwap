import { describe, expect, it, vi } from 'vitest'
import { erc20Abi, decodeFunctionData } from 'viem'
import { getCuratedEvmChain } from '../../../web3/curatedEvmChains.js'
import { sendPlanTransaction, sendPlanWithFees } from './sendNetworkFees.js'
import { submitSendPlan } from './sendExecution.js'

const account = '0x0000000000000000000000000000000000000001'
const recipient = '0x0000000000000000000000000000000000000002'
const token = '0x0000000000000000000000000000000000000003'
const native = { kind: 'native', amountWei: 100n, request: { account, chainId: 1, to: recipient, value: 100n } }
const erc20 = { kind: 'erc20', amountWei: 5_000_000n, request: {
    account, chainId: 1, address: token, abi: erc20Abi, functionName: 'transfer', args: [recipient, 5_000_000n],
} }

describe('Send fee fields survive every signing route', () => {
    it('estimates the exact ERC-20 transfer, never a plain native transfer to the recipient', () => {
        const tx = sendPlanTransaction(erc20)
        expect(tx).toMatchObject({ account, chainId: 1, to: token, value: 0n })
        expect(decodeFunctionData({ abi: erc20Abi, data: tx.data })).toMatchObject({ functionName: 'transfer', args: [recipient, 5_000_000n] })
        expect(sendPlanTransaction(native)).toMatchObject({ account, to: recipient, value: 100n })
    })
    it.each(['native', 'erc20'])('keeps reviewed EIP-1559 caps and nonce for external %s sends', async kind => {
        const chain = getCuratedEvmChain(1)
        const fields = { gas: 80_000n, maxFeePerGas: 200n, maxPriorityFeePerGas: 10n, nonce: 7 }
        const walletClient = { chain, account: { address: account }, sendTransaction: vi.fn(async () => 'hash'), writeContract: vi.fn(async () => 'hash') }
        await submitSendPlan({ walletClient, targetChain: chain, plan: sendPlanWithFees(kind === 'native' ? native : erc20, fields) })
        expect(kind === 'native' ? walletClient.sendTransaction : walletClient.writeContract).toHaveBeenCalledWith(expect.objectContaining(fields))
    })
    it.each(['native', 'erc20'])('keeps legacy gas price and nonce for local %s sends', async kind => {
        const fields = { gas: 80_000n, gasPrice: 200n, nonce: 7 }
        const manager = { sendTransaction: vi.fn(async () => 'hash') }
        await submitSendPlan({ manager, account, targetChain: getCuratedEvmChain(1), plan: sendPlanWithFees(kind === 'native' ? native : erc20, fields) })
        expect(manager.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ ...fields, from: account, chainId: 1 }), { requireActiveChain: false })
    })
})
