import { Wallet, keccak256, toUtf8Bytes } from 'ethers'
import { hashAuthorization } from 'viem/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hardenPistachioWalletManager } from './walletManagerProduction.js'
import { methods as signingMethods } from './walletManagerSigning.js'
import { selfHostedAuthorizationMethods } from './walletManagerSelfHostedPaymasterSigning.js'
import { selfHostedUserOpTypedData } from '../../gas-assist/services/selfHostedPaymaster.js'

// Synthetic test-only signer; no user key, network, browser credential or broadcast.
const signer = new Wallet(keccak256(toUtf8Bytes('pistachio-smart-swap-test-only')))
const delegate = '0xe6Cae83BdE06E4c305530e199D7217f42808555B'
const paymaster = '0x7777777777777777777777777777777777777777'
const entryPoint = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'
const callData = '0x12345678'

function harness() {
    const client = { request: vi.fn(async (method, data) => {
        if (method === 'signMessage') return { signature: await signer.signMessage(data.message) }
        if (method === 'signTransaction') {
            const auth = data.transaction.authorizationList[0]
            const authorization = await signer.authorize({ address: auth.address, chainId: auth.chainId, nonce: auth.nonce })
            return { signedTransaction: await signer.signTransaction({ ...data.transaction, authorizationList: [authorization] }) }
        }
        if (method === 'signTypedData') return { signature: await signer.signTypedData(data.domain, data.types, data.value) }
        throw new Error('Unexpected worker request')
    }) }
    const manager = {
        activeChainId: 56, sessionActive: true, phase: 'locked', address: null, client: null,
        vault: { address: signer.address, vaultId: 'test-vault' }, view: null,
        snapshot: vi.fn(() => ({})), notify: vi.fn(), requestConnection: vi.fn(),
        reauthenticate: vi.fn(async () => undefined),
        unlock: vi.fn(async function () { this.phase = 'unlocked'; this.address = signer.address; this.client = client }),
        lock: vi.fn(async function () { this.phase = 'locked'; this.address = null; this.client = null }),
        requireUnlocked() { if (!this.client) throw new Error('locked') },
        captureSigningContext(chainId) { return { address: signer.address, chainId } },
        assertSigningContext(context) { if (context.chainId !== this.activeChainId) throw new Error('chain changed') },
        recordActivity: vi.fn(), reviewQueue: { request: vi.fn(async () => true) },
        review: signingMethods.review,
        signMessage: signingMethods.signMessage, signTypedData: signingMethods.signTypedData,
        signSelfHostedAuthorization: selfHostedAuthorizationMethods.signSelfHostedAuthorization,
        sendTransaction: vi.fn(), storage: { writePreference: vi.fn() },
        switchChain: vi.fn(), rpcRequest: vi.fn(), rpcUrlForChain: vi.fn(),
    }
    const unlock = manager.unlock
    const lock = manager.lock
    const reauthenticate = manager.reauthenticate
    hardenPistachioWalletManager(manager)
    return { manager, unlock, lock, client, reauthenticate }
}

function challenge() {
    return ['PistachioSwap Gas Assist Authentication', '', 'Domain: swap.example',
        `Wallet: ${signer.address}`, 'Chain ID: 56', 'Nonce: abcdefghijklmnopqrstuvwxyz012345',
        `Issued At: ${new Date(Date.now() - 1_000).toISOString()}`,
        `Expiration Time: ${new Date(Date.now() + 60_000).toISOString()}`, '',
        'This signature authenticates your wallet. It does not authorize a transaction.'].join('\n')
}
function authorization(previousDelegate) {
    return { type: 'eip7702Auth',
        data: { address: delegate, chainId: 56, nonce: 0, ...(previousDelegate ? { previousDelegate } : {}) },
        rawPayload: hashAuthorization({ contractAddress: delegate, chainId: 56, nonce: 0 }) }
}
function operation() {
    return structuredClone(selfHostedUserOpTypedData({
        sender: signer.address, nonce: '0x0', factoryData: '0x', callData,
        verificationGasLimit: '0x10000', callGasLimit: '0x10000', preVerificationGas: '0x1000',
        maxPriorityFeePerGas: '0x1', maxFeePerGas: '0x2',
        paymasterVerificationGasLimit: '0x10000', paymasterPostOpGasLimit: '0x0', paymasterData: '0x' + '11'.repeat(125),
    }, { chainId: 56, delegate, paymaster, entryPoint }))
}
function begin(manager, expiresAt = new Date(Date.now() + 120_000).toISOString()) {
    return manager.beginReviewedGasAssistOperation({
        orderId: 'test-order', walletAddress: signer.address, chainId: 56,
        delegate, paymaster, callData, expiresAt,
    })
}

beforeEach(() => {
    vi.stubEnv('VITE_SELF_HOSTED_PAYMASTER_ENABLED', 'true')
    vi.stubEnv('VITE_SIMPLE_7702_ACCOUNT_ADDRESS', delegate)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('actual smart-swap signing methods', () => {
    it('uses one passkey across authentication, real delegation and real UserOperation signing, then locks', async () => {
        const { manager, unlock, lock, client, reauthenticate } = harness()
        await manager.signMessage({ message: challenge() })
        const finish = begin(manager)
        await manager.signSelfHostedAuthorization(authorization())
        expect(manager.phase).toBe('unlocked')
        expect(await manager.signTypedData(operation())).toMatch(/^0x[0-9a-f]{130}$/i)
        await finish()
        expect(unlock).toHaveBeenCalledOnce()
        expect(reauthenticate).not.toHaveBeenCalled()
        expect(manager.reviewQueue.request).not.toHaveBeenCalled()
        expect(client.request.mock.calls.map(([method]) => method)).toEqual(['signMessage', 'signTransaction', 'signTypedData'])
        expect(lock).toHaveBeenCalledOnce()
        expect(manager.phase).toBe('locked')
    })

    it.each(['callData', 'sender', 'paymaster', 'chain', 'entryPoint', 'schema', 'delegate'])('rejects a changed %s before signing', async (field) => {
        const { manager, client } = harness()
        await manager.signMessage({ message: challenge() })
        const finish = begin(manager)
        await manager.signSelfHostedAuthorization(authorization())
        const typed = operation()
        if (field === 'callData') typed.message.callData = '0x87654321'
        if (field === 'sender') typed.message.sender = paymaster
        if (field === 'paymaster') typed.message.paymasterAndData = delegate + typed.message.paymasterAndData.slice(42)
        if (field === 'chain') typed.domain.chainId = 137
        if (field === 'entryPoint') typed.domain.verifyingContract = paymaster
        if (field === 'schema') typed.types.PackedUserOperation = typed.types.PackedUserOperation.map((entry, i) => i ? entry : { ...entry, type: 'bytes32' })
        if (field === 'delegate') typed.message.initCode = paymaster
        await expect(manager.signTypedData(typed)).rejects.toMatchObject({ code: 'PISTACHIO_REVIEWED_SWAP_MISMATCH' })
        expect(client.request.mock.calls.filter(([method]) => method === 'signTypedData')).toHaveLength(0)
        await finish()
        expect(manager.phase).toBe('locked')
    })

    it('accepts the JSON-encoded provider form without granting reuse after completion', async () => {
        const { manager, unlock } = harness()
        await manager.signMessage({ message: challenge() })
        const finish = begin(manager)
        await manager.signSelfHostedAuthorization(authorization())
        const encoded = JSON.stringify(operation(), (_key, value) => typeof value === 'bigint' ? value.toString() : value)
        await manager.signTypedData(encoded)
        await finish()
        expect(unlock).toHaveBeenCalledOnce()
        // A second operation goes through normal wallet verification and review.
        await manager.signTypedData(encoded)
        expect(unlock).toHaveBeenCalledTimes(2)
        expect(manager.reviewQueue.request).toHaveBeenCalledOnce()
    })

    it('keeps the separate review when replacing another delegation', async () => {
        const { manager } = harness()
        await manager.signMessage({ message: challenge() })
        const finish = begin(manager)
        await manager.signSelfHostedAuthorization(authorization(paymaster))
        expect(manager.reviewQueue.request).toHaveBeenCalledOnce()
        expect(manager.reviewQueue.request.mock.calls[0][0].payload.previousDelegate).toBe(paymaster)
        await finish()
    })

    it('expires the handoff and discards unlocked material', async () => {
        vi.useFakeTimers()
        const { manager } = harness()
        await manager.signMessage({ message: challenge() })
        begin(manager, new Date(Date.now() + 100).toISOString())
        await vi.advanceTimersByTimeAsync(101)
        expect(manager.phase).toBe('locked')
        expect(manager.hasReviewedGasAssistAuthorization(authorization())).toBe(false)
    })

    it('does not reuse the scope for an ordinary typed-data request', async () => {
        const { manager, client } = harness()
        await manager.signMessage({ message: challenge() })
        const finish = begin(manager)
        await expect(manager.signTypedData({ domain: { chainId: 56 }, primaryType: 'Permit', types: {}, message: {} }))
            .rejects.toMatchObject({ code: 'PISTACHIO_REVIEWED_SWAP_MISMATCH' })
        expect(client.request.mock.calls).toHaveLength(1)
        await finish()
    })
})
