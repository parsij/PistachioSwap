import { describe, expect, it, vi } from 'vitest'

import { getCuratedEvmChain } from '../../../web3/curatedEvmChains.js'
import { pistachioConnectorInternals } from '../../passkey/services/pistachioConnector.js'
import { PistachioWalletManager } from '../../passkey/services/walletManager.js'
import {
    CrossChainExecutionError,
    createConnectorWalletClient,
    estimatePreparedCrossChainCosts,
    resolveCurrentCrossChainWallet,
    sendPreparedCrossChainTransaction,
    waitForCrossChainApproval,
} from './crossChainExecution.js'

const ADDRESS = '0x0000000000000000000000000000000000000001'
const TARGET = '0x0000000000000000000000000000000000000002'

describe('cross-chain connector execution', () => {
    it('adds approval and deposit gas with BigInt and converts display-safe native pricing', async () => {
        const publicClient = {
            estimateGas: vi.fn()
                .mockResolvedValueOnce(45_000n)
                .mockResolvedValueOnce(155_000n),
            estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 3_000_000_000n }),
            getGasPrice: vi.fn(),
        }
        const result = await estimatePreparedCrossChainCosts({
            publicClient,
            account: ADDRESS,
            nativeBalanceWei: 1_000_000_000_000_000n,
            nativePriceUsd: '600',
            preparedRoute: {
                publicRouteId: 'relay-route-12345678',
                provider: 'relay',
                sourceAsset: { chainId: 56, address: TARGET },
                costs: { routeCostUsd: '0.04', confidence: 'quote' },
                steps: [
                    { type: 'approval', chainId: 56, transaction: { to: TARGET, data: '0x1234', value: '0' } },
                    { type: 'source-transaction', chainId: 56, transaction: { to: ADDRESS, data: '0xabcd', value: '1' } },
                ],
            },
        })

        expect(result.totalGas).toBe(200_000n)
        expect(result.totalSourceGasWei).toBe(600_000_000_000_000n)
        expect(result.costs).toMatchObject({
            sourceGasNative: '0.0006',
            sourceGasUsd: '0.36',
            routeCostUsd: '0.04',
            totalEstimatedUsd: '0.4',
            confidence: 'prepared',
        })
        expect(publicClient.estimateGas).toHaveBeenNthCalledWith(1, {
            account: ADDRESS,
            to: TARGET,
            data: '0x1234',
            value: 0n,
        })
        expect(publicClient.getGasPrice).not.toHaveBeenCalled()
    })

    it('skips approval gas for native input and reports insufficient native balance', async () => {
        const publicClient = {
            estimateGas: vi.fn().mockResolvedValue(100_000n),
            estimateFeesPerGas: vi.fn().mockRejectedValue(new Error('unsupported')),
            getGasPrice: vi.fn().mockResolvedValue(2_000_000_000n),
        }
        const result = await estimatePreparedCrossChainCosts({
            publicClient,
            account: ADDRESS,
            nativeBalanceWei: 199_999_999_999_999n,
            nativePriceUsd: null,
            preparedRoute: {
                provider: 'relay',
                sourceAsset: {
                    chainId: 56,
                    address: '0x0000000000000000000000000000000000000000',
                },
                costs: { routeCostUsd: '0.04' },
                steps: [
                    { type: 'approval', chainId: 56, transaction: { to: TARGET, data: '0x', value: '0' } },
                    { type: 'source-transaction', chainId: 56, transaction: { to: TARGET, data: '0x', value: '1' } },
                ],
            },
        })

        expect(publicClient.estimateGas).toHaveBeenCalledTimes(1)
        expect(result.totalSourceGasWei).toBe(200_000_000_000_000n)
        expect(result.sufficientNativeGas).toBe(false)
        expect(result.costs.sourceGasUsd).toBeNull()
        expect(result.costs.totalEstimatedUsd).toBeNull()
    })

    it('uses prepared gas metadata only when a dependent deposit cannot be simulated', async () => {
        const publicClient = {
            estimateGas: vi.fn()
                .mockResolvedValueOnce(45_000n)
                .mockRejectedValueOnce(new Error('approval is not mined')),
            estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 2_000_000_000n }),
            getGasPrice: vi.fn(),
        }
        const result = await estimatePreparedCrossChainCosts({
            publicClient,
            account: ADDRESS,
            nativeBalanceWei: 1_000_000_000_000_000n,
            nativePriceUsd: null,
            preparedRoute: {
                provider: 'relay',
                sourceAsset: { chainId: 56, address: TARGET },
                costs: { routeCostUsd: '0.04' },
                steps: [
                    { type: 'approval', chainId: 56, transaction: { to: TARGET, data: '0x', value: '0' } },
                    { type: 'source-transaction', chainId: 56, transaction: {
                        to: ADDRESS, data: '0x', value: '0', gasEstimate: '65000',
                    } },
                ],
            },
        })

        expect(publicClient.estimateGas).toHaveBeenCalledTimes(2)
        expect(result.totalGas).toBe(110_000n)
        expect(result.gasEstimateSources).toEqual(['client', 'prepared-fallback'])
    })

    it('passes the complete Pistachio EIP-1193 provider to custom transport', async () => {
        const manager = {
            chainId: 56,
            async providerRequest(request) {
                if (this !== manager) throw new TypeError('Illegal invocation')
                if (request.method === 'eth_accounts') return [ADDRESS]
                if (request.method === 'eth_chainId') return '0x38'
                return null
            },
            snapshot: () => ({ chainId: 56, phase: 'unlocked', address: ADDRESS }),
            subscribe: () => () => undefined,
        }
        const provider = pistachioConnectorInternals.createProvider(manager)
        const createTransport = vi.fn(() => ({ key: 'custom' }))
        const createClient = vi.fn((options) => ({
            account: { address: options.account },
            chain: options.chain,
            request: provider.request,
        }))

        const client = createConnectorWalletClient({
            account: ADDRESS,
            chain: getCuratedEvmChain(56),
            provider,
            createClient,
            createTransport,
        })

        expect(createTransport).toHaveBeenCalledWith(provider)
        expect(createTransport).not.toHaveBeenCalledWith(provider.request)
        await expect(client.request({ method: 'eth_chainId' })).resolves.toBe('0x38')
        expect(() => createConnectorWalletClient({
            account: ADDRESS,
            chain: getCuratedEvmChain(56),
            provider: provider.request,
        })).toThrow('EIP-1193 provider')
    })

    it('resolves a fresh connector and provider after Wagmi reports the switched chain', async () => {
        const oldConnector = { id: 'old', getProvider: vi.fn() }
        const provider = {
            request: vi.fn(async ({ method }) => method === 'eth_accounts' ? [ADDRESS] : null),
        }
        const currentConnector = {
            id: 'current',
            name: 'Current connector',
            getProvider: vi.fn(async () => provider),
        }
        let switched = false
        const getAccountState = vi.fn(() => switched
            ? { address: ADDRESS, addresses: [ADDRESS], chainId: 8453, connector: currentConnector }
            : { address: ADDRESS, addresses: [ADDRESS], chainId: 56, connector: oldConnector })
        const switchNetwork = vi.fn(async () => { switched = true })
        const createTransport = vi.fn(() => ({ key: 'current-provider' }))

        const result = await resolveCurrentCrossChainWallet({
            config: {},
            connectedAddress: ADDRESS,
            sourceChain: getCuratedEvmChain(8453),
            switchNetwork,
            getAccountState,
            createTransport,
            createClient: ({ account, chain }) => ({ account: { address: account }, chain }),
        })

        expect(switchNetwork).toHaveBeenCalledWith(expect.objectContaining({ id: 8453 }))
        expect(oldConnector.getProvider).not.toHaveBeenCalled()
        expect(currentConnector.getProvider).toHaveBeenCalledWith({ chainId: 8453 })
        expect(createTransport).toHaveBeenCalledWith(provider)
        expect(result.connector).toBe(currentConnector)
        expect(result.walletClient.chain.id).toBe(8453)
    })

    it('passes explicit source-chain transaction fields to the standalone action', async () => {
        const chain = getCuratedEvmChain(56)
        const walletClient = { account: { address: ADDRESS }, chain }
        const send = vi.fn(async () => `0x${'12'.repeat(32)}`)
        const hash = await sendPreparedCrossChainTransaction({
            walletClient,
            connectedAddress: ADDRESS,
            sourceChain: chain,
            destinationChainId: 8453,
            routeId: 'route-1',
            step: {
                type: 'approval',
                chainId: 56,
                transaction: { to: TARGET, data: '0x1234', value: '0', gas: '21000' },
            },
            send,
        })

        expect(hash).toMatch(/^0x/)
        expect(send).toHaveBeenCalledWith(walletClient, {
            account: ADDRESS,
            chain,
            to: TARGET,
            data: '0x1234',
            value: 0n,
            gas: 21_000n,
        })
    })

    it('stops after approval rejection and never opens the deposit', async () => {
        const rejection = Object.assign(new Error('User rejected the request.'), { code: 4001 })
        const send = vi.fn(async (_client, request) => {
            if (request.to === TARGET) throw rejection
            return `0x${'34'.repeat(32)}`
        })
        const walletClient = {
            account: { address: ADDRESS },
            chain: getCuratedEvmChain(56),
        }
        await expect(sendPreparedCrossChainTransaction({
            walletClient,
            connectedAddress: ADDRESS,
            sourceChain: walletClient.chain,
            destinationChainId: 8453,
            step: { type: 'approval', chainId: 56, transaction: { to: TARGET, data: '0x', value: '0' } },
            send,
        })).rejects.toMatchObject({
            phase: 'send-approval',
            cause: rejection,
        })
        expect(send).toHaveBeenCalledTimes(1)
    })

    it('waits for approval confirmation and reports a reverted approval', async () => {
        const wait = vi.fn(async () => ({ status: 'success' }))
        await waitForCrossChainApproval({
            config: {}, chainId: 56, hash: `0x${'12'.repeat(32)}`, wait,
        })
        expect(wait).toHaveBeenCalledWith({}, expect.objectContaining({
            chainId: 56,
            confirmations: 1,
        }))

        await expect(waitForCrossChainApproval({
            config: {},
            chainId: 56,
            hash: `0x${'34'.repeat(32)}`,
            wait: vi.fn(async () => ({ status: 'reverted' })),
        })).rejects.toBeInstanceOf(CrossChainExecutionError)
    })

    it('binds browser fetch to its native global receiver in the real wallet manager', async () => {
        function browserFetch(_url, options) {
            if (this !== globalThis) throw new TypeError('Illegal invocation')
            const request = JSON.parse(options.body)
            return Promise.resolve(new Response(JSON.stringify({
                jsonrpc: '2.0', id: request.id, result: '0x38',
            }), { status: 200 }))
        }
        expect(() => Reflect.apply(browserFetch, {}, ['https://rpc.example', {}]))
            .toThrow('Illegal invocation')
        const manager = new PistachioWalletManager({
            fetchImpl: browserFetch,
            windowImpl: null,
            rpcUrlForChain: () => 'https://rpc.example',
        })

        await expect(manager.rpcRequest(56, 'eth_chainId', []))
            .resolves.toBe('0x38')
    })
})
