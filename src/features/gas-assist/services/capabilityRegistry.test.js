import { describe, expect, it, afterEach } from 'vitest'
import { deriveSwapExecution } from '../../../services/swapExecutionMode.js'
import { rememberGasAssistCapabilities, getGasAssistCapability, clearGasAssistCapabilities } from './capabilityRegistry.js'
import { getChainCapabilities } from '../../../web3/curatedEvmChains.js'
const ids = [1, 10, 56, 100, 130, 137, 8453, 34443, 42161, 42220, 59144, 80094, 534352]
afterEach(clearGasAssistCapabilities)
describe('backend-authoritative multichain Gas Assist', () => {
    it.each(ids)('chain %i remains disabled until the backend explicitly enables its source capability', id => {
        expect(getChainCapabilities(id).gasAssist).toBe(false)
        const deployment = { chainId: id, enabled: true, paymaster: '0x1111111111111111111111111111111111111111', supported: true }
        rememberGasAssistCapabilities({ capabilities: { [id]: deployment } })
        expect(getChainCapabilities(id).gasAssist).toBe(true)
        rememberGasAssistCapabilities({ capabilities: { [id]: { ...deployment, enabled: false } } })
        expect(getChainCapabilities(id).gasAssist).toBe(false)
        expect(getGasAssistCapability(id).paymaster).toBe(deployment.paymaster)
    })
    it.each([43114, 324, 480, 5000, 146, 1088, 25, 1284, 167000, 204, 81457])('excluded chain %i never enters the assisted lane with zero native gas', id => {
        const result = deriveSwapExecution({
            isConnected: true, walletAddress: '0x1111111111111111111111111111111111111111', chainId: id,
            nativeBalanceStatus: 'success', nativeBalance: 0n, sellAmount: '1',
            sellToken: { chainId: id, address: '0x2222222222222222222222222222222222222222', decimals: 18 },
            buyToken: { chainId: id, address: '0x3333333333333333333333333333333333333333', decimals: 18 },
            gasAssistConfigStatus: 'success', gasAssistConfig: { chainId: id, supported: false, enabled: false },
        })
        expect(result.mode).toBeNull()
        expect(result.reason).toBe('gas-assist-unsupported')
    })
})
