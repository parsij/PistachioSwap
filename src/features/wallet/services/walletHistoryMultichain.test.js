import { describe, it, expect, afterEach } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem'
import { buildReceiptHistoryRow, classifyReceiptHistoryRow, ENTRY_POINT_V08_ADDRESS } from './walletHistoryClassifier.js'
import { rememberGasAssistCapabilities, clearGasAssistCapabilities } from '../../gas-assist/services/capabilityRegistry.js'
const ids = [1,10,56,100,130,137,8453,34443,42161,42220,59144,80094,534352]
const wallet = '0x1111111111111111111111111111111111111111'
const paymaster = '0x2222222222222222222222222222222222222222'
const router = '0x3333333333333333333333333333333333333333'
const sell = '0x4444444444444444444444444444444444444444'
const buy = '0x5555555555555555555555555555555555555555'
const hash = '0x' + 'ab'.repeat(32)
const transferAbi = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)'])
const operationAbi = parseAbi(['event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)'])
function operation(sender = wallet, sponsor = paymaster) {
    return { address: ENTRY_POINT_V08_ADDRESS, topics: encodeEventTopics({ abi: operationAbi, eventName: 'UserOperationEvent', args: { userOpHash: hash, sender, paymaster: sponsor } }),
        data: encodeAbiParameters([{ type: 'uint256' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }], [0n,true,1n,1n]) }
}
function row(id, operations = [operation()]) {
    const transfer = (address, from, to, value) => ({ address, topics: encodeEventTopics({ abi: transferAbi, eventName: 'Transfer', args: { from, to } }), data: encodeAbiParameters([{ type: 'uint256' }], [value]) })
    return buildReceiptHistoryRow({ chainId: id, walletAddress: wallet,
        transaction: { hash, from: router, to: ENTRY_POINT_V08_ADDRESS, value: '0x0', input: '0x' },
        receipt: { status: '0x1', transactionHash: hash, logs: [...operations,transfer(sell,wallet,router,100n),transfer(buy,router,wallet,200n)] },
        indexedTransfers: [{ rawContract: { address: sell, decimal: '0x0' }, asset: 'SELL' }, { rawContract: { address: buy, decimal: '0x0' }, asset: 'BUY' }],
    })
}
afterEach(clearGasAssistCapabilities)
describe('paused source-chain Gas Assist receipt history', () => {
    it.each(ids)('recognizes successful paired wallet/Paymaster proof on disabled chain %i', id => {
        rememberGasAssistCapabilities({ capabilities: { [id]: { chainId: id, enabled: false, paymaster } } })
        const receipt = row(id)
        expect(receipt.user_operations[0].success).toBe(true)
        expect(classifyReceiptHistoryRow(id, wallet, receipt)?.provider).toBe('pistachio-self-hosted-gas-assist')
    })
    it('does not combine the sender from one UserOperation with the Paymaster from another', () => {
        rememberGasAssistCapabilities({ capabilities: { 1: { chainId: 1, enabled: false, paymaster } } })
        expect(classifyReceiptHistoryRow(1,wallet,row(1,[operation(wallet,router),operation(router,paymaster)]))).toBeNull()
    })
})
