import { describe, expect, it, vi } from 'vitest'
import { erc20Abi, decodeFunctionData } from 'viem'

import { getCuratedEvmChain } from '../../../web3/curatedEvmChains.js'
import {
    resolveSendWallet,
    submitSendPlan,
    sendExecutionInternals,
} from './sendExecution.js'

const account = '0x0000000000000000000000000000000000000001'
const recipient = '0x0000000000000000000000000000000000000002'
const base = getCuratedEvmChain(8453)

function fakeClientFactory(captured) {
    return ({ account: walletAccount, chain, transport }) => {
        const provider = transport
        const client = {
            account: { address: walletAccount },
            chain,
            sendTransaction: vi.fn(async (request) =>
                provider.request({
                    method: 'eth_sendTransaction',
                    params: [{
                        from: walletAccount,
                        to: request.to,
                        value: `0x${BigInt(request.value ?? 0n).toString(16)}`,
                        chainId: `0x${chain.id.toString(16)}`,
                    }],
                })),
            writeContract: vi.fn(async (request) =>
                provider.request({
                    method: 'eth_sendTransaction',
                    params: [{
                        from: walletAccount,
                        to: request.address,
                        data: '0x1234',
                        value: '0x0',
                        chainId: `0x${chain.id.toString(16)}`,
                    }],
                })),
        }
        captured.client = client
        return client
    }
}

describe('selected-token Send execution', () => {
    it('keeps Pistachio Wallet on its global chain while pinning Send to the selected token chain', async () => {
        const sendTransaction = vi.fn(async () => `0x${'ab'.repeat(32)}`)
        const manager = {
            initialize: vi.fn(async () => undefined),
            snapshot: vi.fn(() => ({
                sessionActive: true,
                address: null,
                vault: { address: account },
                chainId: 56,
            })),
            switchChain: vi.fn(),
            sendTransaction,
        }

        const resolved = await resolveSendWallet({
            connectedAddress: account,
            targetChain: base,
            connector: { id: 'pistachio-local' },
            manager,
        })

        expect(manager.switchChain).not.toHaveBeenCalled()
        expect(resolved.connectorId).toBe('pistachio-local')
        expect(resolved.manager).toBe(manager)
        expect(resolved.walletClient).toBeNull()

        const hash = await submitSendPlan({
            manager: resolved.manager,
            account: resolved.account,
            targetChain: base,
            plan: {
                kind: 'native',
                amountWei: 1n,
                request: { to: recipient },
            },
        })

        expect(hash).toBe(`0x${'ab'.repeat(32)}`)
        expect(sendTransaction).toHaveBeenCalledWith(
            expect.objectContaining({
                chainId: 8453,
                from: account,
                to: recipient,
                value: 1n,
            }),
            { requireActiveChain: false },
        )
    })

    it('uses the selected token chain for an external connector without consulting swap-page chain state', async () => {
        let providerChainId = 56
        const provider = {
            request: vi.fn(async ({ method }) => {
                if (method === 'eth_chainId') return `0x${providerChainId.toString(16)}`
                if (method === 'eth_accounts') return [account]
                throw new Error(`Unexpected method: ${method}`)
            }),
        }
        const connector = {
            id: 'injected',
            getProvider: vi.fn(async () => provider),
            switchChain: vi.fn(async ({ chainId }) => {
                providerChainId = Number(chainId)
            }),
        }
        const captured = {}
        const resolved = await resolveSendWallet({
            connectedAddress: account,
            targetChain: base,
            connector,
            createClient: fakeClientFactory(captured),
            createTransport: (value) => value,
        })

        expect(connector.switchChain).toHaveBeenCalledWith({ chainId: 8453 })
        expect(resolved.walletClient.chain.id).toBe(8453)
        expect(provider.request).toHaveBeenCalledWith({ method: 'eth_chainId' })
    })

    it('encodes Base ERC-20 transfer calldata for the local passkey signer without a network switch', async () => {
        const sendTransaction = vi.fn(async () => `0x${'ef'.repeat(32)}`)
        const plan = {
            kind: 'erc20',
            amountWei: 291426n,
            request: {
                address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
                abi: [{
                    type: 'function',
                    name: 'transfer',
                    stateMutability: 'nonpayable',
                    inputs: [
                        { name: 'recipient', type: 'address' },
                        { name: 'amount', type: 'uint256' },
                    ],
                    outputs: [{ name: '', type: 'bool' }],
                }],
                functionName: 'transfer',
                args: [recipient, 291426n],
            },
        }

        await expect(submitSendPlan({
            manager: { sendTransaction },
            account,
            targetChain: base,
            plan,
        })).resolves.toBe(`0x${'ef'.repeat(32)}`)

        expect(sendTransaction).toHaveBeenCalledWith(
            expect.objectContaining({
                chainId: 8453,
                from: account,
                to: plan.request.address,
                data: expect.stringMatching(/^0xa9059cbb/u),
                value: 0n,
            }),
            { requireActiveChain: false },
        )
    })

    it('submits an ERC-20 transfer through the chain-bound wallet client', async () => {
        const writeContract = vi.fn(async () => `0x${'cd'.repeat(32)}`)
        const walletClient = {
            account: { address: account },
            chain: base,
            writeContract,
        }
        const plan = {
            kind: 'erc20',
            amountWei: 291426n,
            request: {
                address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
                abi: [],
                functionName: 'transfer',
                args: [recipient, 291426n],
            },
        }

        await expect(submitSendPlan({
            walletClient,
            targetChain: base,
            plan,
        })).resolves.toBe(`0x${'cd'.repeat(32)}`)

        expect(writeContract).toHaveBeenCalledWith(expect.objectContaining({
            account: walletClient.account,
            chain: base,
            address: plan.request.address,
            functionName: 'transfer',
            args: [recipient, 291426n],
        }))
    })

    it('fails closed if the provider account no longer matches the reviewed account', async () => {
        const provider = {
            request: vi.fn(async ({ method }) => {
                if (method === 'eth_chainId') return '0x2105'
                if (method === 'eth_accounts') {
                    return ['0x0000000000000000000000000000000000000009']
                }
                throw new Error(`Unexpected method: ${method}`)
            }),
        }
        const connector = {
            id: 'injected',
            getProvider: vi.fn(async () => provider),
        }

        await expect(resolveSendWallet({
            connectedAddress: account,
            targetChain: base,
            connector,
            createClient: fakeClientFactory({}),
            createTransport: (value) => value,
        })).rejects.toThrow('wallet account changed')
    })
})


describe('WalletConnect numeric chain IDs', () => {
    it.each([1, 10, 56, 8453])('reaches the wallet signing request on chain %s using the real Viem client', async (chainId) => {
        const targetChain = getCuratedEvmChain(chainId)
        const hash = `0x${'ca'.repeat(32)}`
        const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        const provider = { request: vi.fn(async ({ method }) => {
            if (method === 'eth_chainId') return chainId
            if (method === 'eth_accounts') return [account]
            if (method === 'eth_sendTransaction') return hash
            throw new Error(`Unexpected method: ${method}`)
        }) }
        const connector = {
            id: 'walletConnect',
            getProvider: vi.fn(async () => provider),
            switchChain: vi.fn(async () => { throw new Error('Unnecessary switch') }),
        }
        const resolved = await resolveSendWallet({ connectedAddress: account, targetChain, connector })
        await expect(submitSendPlan({
            walletClient: resolved.walletClient,
            targetChain,
            plan: { kind: 'erc20', amountWei: 5_000_000n, request: {
                address: token, abi: erc20Abi, functionName: 'transfer', args: [recipient, 5_000_000n],
            } },
        })).resolves.toBe(hash)
        expect(connector.switchChain).not.toHaveBeenCalled()
        const tx = provider.request.mock.calls.find(([request]) => request.method === 'eth_sendTransaction')[0].params[0]
        expect(tx).toMatchObject({ from: account, to: token })
        await expect(resolved.walletClient.getChainId()).resolves.toBe(chainId)
        expect(decodeFunctionData({ abi: erc20Abi, data: tx.data })).toMatchObject({ functionName: 'transfer', args: [recipient, 5_000_000n] })
    })

    it('recognizes a numeric chain ID after an actual network switch', async () => {
        let chainId = 56
        const provider = { request: vi.fn(async ({ method }) => method === 'eth_chainId' ? chainId : [account]) }
        const connector = { id: 'walletConnect', getProvider: vi.fn(async () => provider), switchChain: vi.fn(async () => { chainId = 1 }) }
        const resolved = await resolveSendWallet({ connectedAddress: account, targetChain: getCuratedEvmChain(1), connector })
        expect(resolved.walletClient.chain.id).toBe(1)
        expect(connector.switchChain).toHaveBeenCalledExactlyOnceWith({ chainId: 1 })
    })

    it.each([0, -1, NaN, Infinity, 1.5, '1', '0x0', null, {}, Number.MAX_SAFE_INTEGER + 1])('rejects invalid chain IDs: %s', (value) => {
        expect(sendExecutionInternals.parseProviderChainId(value)).toBeNull()
    })
})
