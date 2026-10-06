import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseTransaction, recoverTransactionAddress } from 'viem'
import { recoverAuthorizationAddress } from 'viem/utils'
import { GAS_ASSIST_SOURCE_CHAIN_IDS } from '../../gas-assist/model/gasAssistChains.js'

// Exercise the real worker's message boundary and real signatures, rather than
// mocking the signer or stopping before the worker receives the envelope.
let listener
let nextId = 0
const responses = new Map()
async function request(operation, payload = {}) {
    const id = ++nextId
    await listener({ data: { id, operation, payload } })
    const response = responses.get(id)
    responses.delete(id)
    if (!response.ok) throw Object.assign(new Error(response.error.message), { code: response.error.code })
    return response.result
}
const delegate = '0xe6Cae83BdE06E4c305530e199D7217f42808555B'
let wallet
function envelope(chainId, authorizationChainId = chainId) {
    return { chainId, type: 4, from: wallet, to: wallet, nonce: 0, gasLimit: 21000n,
        maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, value: 0n, data: '0x',
        authorizationList: [{ chainId: authorizationChainId, address: delegate, nonce: 3 }] }
}
beforeAll(async () => {
    vi.stubGlobal('self', {
        addEventListener: (_name, handler) => { listener = handler },
        postMessage: (response) => responses.set(response.id, response),
        close: () => {},
    })
    await import('./walletWorker.js')
    await request('setSetupPasskey', { keyWrap: { id: 'test-only' }, prfOutput: new Uint8Array(32).fill(7) })
    wallet = (await request('importPrivateKey', { privateKey: `0x${'11'.repeat(32)}` })).address
})
afterAll(async () => {
    if (listener) await request('destroy')
    vi.unstubAllGlobals()
})
describe('real worker Gas Assist authorization', () => {
    it.each(GAS_ASSIST_SOURCE_CHAIN_IDS)('signs exactly the selected source chain %i', async (chainId) => {
        const { signedTransaction } = await request('signTransaction', { mode: 'gas-assist-authorization', transaction: envelope(chainId) })
        const parsed = parseTransaction(signedTransaction)
        expect(parsed.chainId).toBe(chainId)
        expect(parsed.authorizationList).toHaveLength(1)
        const authorization = parsed.authorizationList[0]
        expect(Number(authorization.chainId)).toBe(chainId)
        expect(Number(authorization.nonce)).toBe(3)
        expect(authorization.address.toLowerCase()).toBe(delegate.toLowerCase())
        expect(await recoverAuthorizationAddress({ authorization })).toBe(wallet)
        expect(await recoverTransactionAddress({ serializedTransaction: signedTransaction })).toBe(wallet)
    })
    it.each([[137, 56], [8453, 0], [43114, 43114]])('rejects source %i with authorization scope %i', async (chainId, authorizationChainId) => {
        await expect(request('signTransaction', { mode: 'gas-assist-authorization', transaction: envelope(chainId, authorizationChainId) })).rejects.toThrow()
    })
    it('still rejects funded envelopes and normal-mode type-4 transactions', async () => {
        await expect(request('signTransaction', { mode: 'gas-assist-authorization', transaction: { ...envelope(137), maxFeePerGas: 1n } })).rejects.toThrow()
        await expect(request('signTransaction', { mode: 'normal', transaction: envelope(137) })).rejects.toThrow()
    })
})
