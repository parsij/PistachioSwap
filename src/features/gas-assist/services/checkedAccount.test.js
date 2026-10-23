import { checkedAccountRuntime } from './checkedAccount.fixture.js'
import { describe, expect, it } from 'vitest'
import { encodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toHex } from 'viem'
import { verifyCheckedAccountDeployment } from './checkedAccount.js'
const abi = parseAbi(['function executionVersion() view returns (bytes32)', 'function ENTRY_POINT() view returns (address)', 'function TRUSTED_DELEGATE() view returns (address)'])
const settings = { entryPoint: '0x1111111111111111111111111111111111111111', paymaster: '0x2222222222222222222222222222222222222222', delegate: '0x3333333333333333333333333333333333333333', checkedExecution: Object.fromEntries(['entryPointCodeHash', 'paymasterCodeHash', 'delegateCodeHash'].map(key => [key, keccak256(key === 'delegateCodeHash' ? checkedAccountRuntime : '0x6000')])) }
function rpc(overrides = {}) {
    return async (method, params) => {
        if (method === 'eth_getCode') return overrides[params[0]] ?? (params[0] === settings.delegate ? checkedAccountRuntime : '0x6000')
        for (const [functionName, result] of [['executionVersion', keccak256(toHex('pistachio-checked-7702-v1'))], ['ENTRY_POINT', settings.entryPoint], ['TRUSTED_DELEGATE', settings.delegate]]) {
            if (params[0].data === encodeFunctionData({ abi, functionName })) return encodeFunctionResult({ abi, functionName, result: overrides[functionName] ?? result })
        }
        throw new Error('Unexpected RPC')
    }
}
describe('independent checked deployment verification before signing', () => {
    it('accepts matching code and immutable bindings', async () => {
        await expect(verifyCheckedAccountDeployment(settings, rpc())).resolves.toBeUndefined()
    })
    it.each(['entryPoint', 'paymaster', 'delegate'])('rejects missing or changed %s code', async key => {
        for (const code of ['0x', '0x6001']) await expect(verifyCheckedAccountDeployment(settings, rpc({ [settings[key]]: code }))).rejects.toMatchObject({ code: 'PAYMASTER_CHECKED_DEPLOYMENT_INVALID' })
    })
    it.each(['executionVersion', 'ENTRY_POINT', 'TRUSTED_DELEGATE'])('rejects changed %s', async key => {
        const value = key === 'executionVersion' ? `0x${'00'.repeat(32)}` : '0x4444444444444444444444444444444444444444'
        await expect(verifyCheckedAccountDeployment(settings, rpc({ [key]: value }))).rejects.toMatchObject({ code: 'PAYMASTER_CHECKED_DEPLOYMENT_INVALID' })
    })
})
