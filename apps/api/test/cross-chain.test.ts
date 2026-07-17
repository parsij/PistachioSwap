import Fastify from 'fastify'
import { encodeFunctionData } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAcrossAdapter } from '../src/cross-chain/adapters/across/index.js'
import {
    createChainflipSdkClient,
    mapChainflipStatus,
} from '../src/cross-chain/adapters/chainflip/sdk-client.js'
import { createDebridgeAdapter } from '../src/cross-chain/adapters/debridge/index.js'
import { createRelayAdapter } from '../src/cross-chain/adapters/relay/index.js'
import { createCrossChainAuthService } from '../src/cross-chain/auth.js'
import { CrossChainRegistry } from '../src/cross-chain/registry.js'
import { getPlatformFeeConfiguration } from '../src/cross-chain/fees.js'
import { MemoryCrossChainRouteRepository } from '../src/cross-chain/repository.js'
import { CrossChainRouteService } from '../src/cross-chain/service.js'
import type { HttpJson } from '../src/cross-chain/types.js'
import {
    validateCrossChainRequest,
    validateExactApprovalTransaction,
    validateProviderTransaction,
} from '../src/cross-chain/validation.js'
import { createCrossChainRoutes } from '../src/modules/cross-chain.js'
import {
    destinationToken,
    fixtureAdapter,
    fixtureQuote,
    request,
    sender,
    sourceToken,
    target,
} from './fixtures/cross-chain.js'

const approveAbi = [{
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
        { name: 'spender', type: 'address' },
        { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
}] as const
const relaySpender = '0x0000000000000000000000000000000000000005'
const approvalData = (spenderAddress = target, amount = 1000n) =>
    encodeFunctionData({
        abi: approveAbi,
        functionName: 'approve',
        args: [spenderAddress as `0x${string}`, amount],
    })

describe('cross-chain backend', () => {
    const previousEnv = { ...process.env }

    afterEach(() => {
        process.env = { ...previousEnv }
    })

    it('caches capabilities and ranks by fee-adjusted minimum output', async () => {
        const across = fixtureAdapter('across', '950', '100')
        const relay = fixtureAdapter('relay', '900')
        const registry = new CrossChainRegistry([across, relay])

        await registry.getCapabilities('across')
        await registry.getCapabilities('across')
        const result = await registry.quote(request)

        expect(result.selectedQuote.provider).toBe('relay')
        expect(result.quotes).toHaveLength(2)
    })

    it('strictly normalizes the current frontend alias request', () => {
        const normalized = validateCrossChainRequest({
            sourceChainId: 1,
            destinationChainId: 8453,
            sourceToken,
            destinationToken,
            amount: '1000',
            account: sender,
            recipient: sender,
            slippageBps: 50,
        })
        expect(normalized).toMatchObject({
            mode: 'exactIn',
            ownerAddress: sender,
            sourceAsset: { chainId: 1, address: sourceToken },
            walletCapabilities: { evmTransaction: true, depositChannel: true },
        })
        expect(() => validateCrossChainRequest({
            ...normalized,
            sourceToken,
        })).toThrow('unsupported fields')
    })

    it('rejects transaction targets not supplied by capability metadata', () => {
        expect(() => validateProviderTransaction({
            to: '0x0000000000000000000000000000000000000099',
            data: '0x1234',
            value: '0',
        }, request, {
            provider: 'across',
            available: true,
            fetchedAt: new Date().toISOString(),
            routes: [{
                sourceChainId: 1,
                destinationChainId: 8453,
                transactionTargets: [target],
            }],
        })).toThrow('capability metadata')
    })

    it.each([
        [
            'spender',
            {
                chainId: 1,
                to: sourceToken,
                data: approvalData('0x0000000000000000000000000000000000000099'),
                value: '0',
            },
            'spender',
        ],
        [
            'amount',
            { chainId: 1, to: sourceToken, data: approvalData(target, 1001n), value: '0' },
            'amount',
        ],
        [
            'token',
            {
                chainId: 1,
                to: '0x0000000000000000000000000000000000000099',
                data: approvalData(),
                value: '0',
            },
            'source token',
        ],
        [
            'chain',
            { chainId: 8453, to: sourceToken, data: approvalData(), value: '0' },
            'wrong chain',
        ],
    ])('rejects an approval with a changed %s', (_field, transaction, message) => {
        expect(() => validateExactApprovalTransaction(transaction, {
            chainId: 1,
            token: sourceToken,
            spenders: [target],
            amount: '1000',
        })).toThrow(message)
    })

    it('normalizes official Across allowance approvals in order and exactly', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const adapter = createAcrossAdapter(async (url) =>
            url.pathname.endsWith('/available-routes')
                ? [{
                      originChainId: 1,
                      destinationChainId: 8453,
                      originToken: sourceToken,
                      destinationToken,
                      spokePoolAddress: target,
                  }]
                : {
                      expectedOutputAmount: '900',
                      minOutputAmount: '890',
                      checks: {
                          allowance: {
                              token: sourceToken,
                              spender: target,
                              actual: '0',
                              expected: '1000',
                          },
                      },
                      approvalTxns: [{
                          chainId: 1,
                          to: sourceToken,
                          data: approvalData(),
                          value: '0',
                      }],
                      swapTx: { chainId: 1, to: target, data: '0x1234', value: '0' },
                  },
        )
        const quote = await adapter.getQuote(request, await adapter.getCapabilities())
        expect(quote.steps.map(({ type, index }) => [type, index])).toEqual([
            ['approval', 0],
            ['source-transaction', 1],
        ])
        expect(quote.steps[0]?.transaction?.allowanceTarget).toBe(target)
    })

    it('never emits an approval step for native input', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const nativeRequest = {
            ...request,
            sourceAsset: {
                ...request.sourceAsset,
                address: '0x0000000000000000000000000000000000000000',
            },
        }
        const adapter = createAcrossAdapter(async (url) =>
            url.pathname.endsWith('/available-routes')
                ? [{
                      originChainId: 1,
                      destinationChainId: 8453,
                      originToken: nativeRequest.sourceAsset.address,
                      destinationToken,
                      spokePoolAddress: target,
                  }]
                : {
                      expectedOutputAmount: '900',
                      minOutputAmount: '890',
                      approvalTxns: [{
                          chainId: 1,
                          to: sourceToken,
                          data: approvalData(),
                          value: '0',
                      }],
                      swapTx: { chainId: 1, to: target, data: '0x1234', value: '1000' },
                  },
        )
        const quote = await adapter.getQuote(nativeRequest, await adapter.getCapabilities())
        expect(quote.steps.map(({ type }) => type)).toEqual(['source-transaction'])
    })

    it('normalizes current Across Swap API fixtures and validates SpokePool metadata', async () => {
        process.env.PLATFORM_FEE_BPS = '45'
        process.env.TREASURY_ADDRESS = sender
        let quoteUrl: URL | null = null
        const http: HttpJson = async (url) => {
            if (url.pathname.endsWith('/available-routes')) return [{
                      originChainId: 1,
                      destinationChainId: 8453,
                      originToken: sourceToken,
                      destinationToken,
                      spokePoolAddress: target,
                  }]
            quoteUrl = url
            return {
                      id: 'across-status',
                      expectedOutputAmount: '900',
                      minOutputAmount: '890',
                      expectedFillTime: 12,
                      spokePoolAddress: target,
                      swapTx: { chainId: 1, to: target, data: '0x1234', value: '0' },
                      fees: { total: { amount: '10' } },
                  }
        }
        const adapter = createAcrossAdapter(http)
        const capabilities = await adapter.getCapabilities()
        const quote = await adapter.getQuote(request, capabilities)
        expect(quote.transaction.to).toBe(target)
        expect(quote.minimumBuyAmount).toBe('890')
        expect(quoteUrl!.searchParams.get('appFee')).toBe('0.0045')
        expect(quoteUrl!.searchParams.get('appFeeRecipient')).toBe(sender)
        expect(quote.fees.filter(({ type }) => type === 'platform')).toEqual([
            expect.objectContaining({ amount: '4' }),
        ])
    })

    it('normalizes current deBridge create-tx fixtures', async () => {
        process.env.PLATFORM_FEE_BPS = '45'
        process.env.TREASURY_ADDRESS = sender
        let quoteUrl: URL | null = null
        const http: HttpJson = async (url) => {
            if (url.pathname.endsWith('/supported-chains-info')) return {
                      chains: [
                          { chainId: 1, originalChainId: 1 },
                          { chainId: 100000002, originalChainId: 8453 },
                      ],
                  }
            quoteUrl = url
            return {
                      orderId: 'debridge-status',
                      estimation: {
                          dstChainTokenOut: { amount: '900', recommendedAmount: '890' },
                          recommendedSlippage: 0.005,
                          costsDetails: [],
                      },
                      tx: {
                          chainId: 1,
                          to: '0xef4fb24ad0916217251f553c0596f8edc630eb66',
                          data: '0x1234',
                          value: '0',
                          allowanceTarget: target,
                          allowanceValue: '1000',
                      },
                  }
        }
        const adapter = createDebridgeAdapter(http)
        const capabilities = await adapter.getCapabilities()
        const quote = await adapter.getQuote(request, capabilities)
        expect(quote.minimumBuyAmount).toBe('890')
        expect(quote.statusId).toBe('debridge-status')
        expect(quote.steps.map(({ type }) => type)).toEqual([
            'approval',
            'source-transaction',
        ])
        expect(quote.steps[0]?.transaction).toMatchObject({
            to: sourceToken,
            allowanceTarget: target,
            data: approvalData(),
        })
        expect(quoteUrl!.searchParams.get('dstChainId')).toBe('100000002')
        expect(quoteUrl!.searchParams.get('affiliateFeePercent')).toBe('0.45')
        expect(quote.fees.filter(({ type }) => type === 'platform')).toEqual([
            expect.objectContaining({ amount: '4' }),
        ])
    })

    it('uses only per-chain Relay metadata and preserves ordered transactions', async () => {
        process.env.PLATFORM_FEE_BPS = '45'
        process.env.TREASURY_ADDRESS = sender
        let relayBody: Record<string, unknown> | null = null
        const http: HttpJson = async (url, options) => {
            if (url.pathname.endsWith('/chains')) return {
                      chains: [
                          { id: 1, contracts: { approvalProxy: relaySpender, router: target } },
                          { id: 8453, contracts: { router: destinationToken } },
                      ],
                  }
            relayBody = options?.body as Record<string, unknown>
            return {
                      steps: [
                          {
                              id: 'approve',
                              items: [{
                                  data: {
                                      chainId: 1,
                                      to: sourceToken,
                                      data: approvalData(relaySpender),
                                      value: '0',
                                  },
                              }],
                          },
                          {
                              id: 'deposit',
                              requestId: 'relay-status',
                              items: [{
                                  data: {
                                      chainId: 1,
                                      to: target,
                                      data: '0x1234',
                                      value: '0',
                                  },
                              }],
                          },
                      ],
                      details: {
                          timeEstimate: 15,
                          currencyOut: { amount: '900', minimumAmount: '890' },
                      },
                      fees: {},
                  }
        }
        const adapter = createRelayAdapter(http)
        const capabilities = await adapter.getCapabilities()
        const quote = await adapter.getQuote(request, capabilities)
        expect(quote.statusId).toBe('relay-status')
        expect(quote.steps.map((step) => step.type)).toEqual([
            'approval',
            'source-transaction',
        ])
        expect(quote.steps.map((step) => step.transaction?.to)).toEqual([
            sourceToken,
            target,
        ])
        expect(relayBody!.appFees).toEqual([{ recipient: sender, fee: '45' }])
        expect(quote.fees.filter(({ type }) => type === 'platform')).toEqual([
            expect.objectContaining({ amount: '4' }),
        ])
    })

    it('fails closed when Across quote target is absent from capabilities', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const malicious = '0x0000000000000000000000000000000000000099'
        const adapter = createAcrossAdapter(async (url) =>
            url.pathname.endsWith('/available-routes')
                ? [{
                      originChainId: 1,
                      destinationChainId: 8453,
                      originToken: sourceToken,
                      destinationToken,
                      spokePoolAddress: target,
                  }]
                : {
                      expectedOutputAmount: '900',
                      minOutputAmount: '890',
                      spokePoolAddress: malicious,
                      swapTx: {
                          chainId: 1,
                          to: malicious,
                          data: '0x1234',
                          value: '0',
                      },
                  },
        )
        await expect(
            adapter.getQuote(request, await adapter.getCapabilities()),
        ).rejects.toThrow('capability metadata')
    })

    it('marks fee collection incompatible without a treasury or mechanism', async () => {
        process.env.PLATFORM_FEE_BPS = '45'
        delete process.env.TREASURY_ADDRESS
        expect(() => getPlatformFeeConfiguration('relay')).toThrow('recipient is unavailable')
        const http = vi.fn()
        expect(await createRelayAdapter(http).getCapabilities()).toMatchObject({
            available: false,
            reason: expect.stringContaining('recipient is unavailable'),
        })
        expect(http).not.toHaveBeenCalled()
        process.env.TREASURY_ADDRESS = sender
        expect(() => getPlatformFeeConfiguration('chainflip')).toThrow('incompatible')
    })

    it('does not infer a deBridge deployment for an unknown EVM chain', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const adapter = createDebridgeAdapter(async () => ({
            chains: [
                { chainId: 10, originalChainId: 10 },
                { chainId: 100000002, originalChainId: 8453 },
            ],
        }))
        const capabilities = await adapter.getCapabilities()
        expect(capabilities.routes.some(({ sourceChainId }) => sourceChainId === 10)).toBe(false)
    })

    it('uses mocked Chainflip SDK discovery, quote, prepare and state mapping', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const requestDepositAddressV2 = vi.fn(async () => ({
            depositChannelId: 'channel-1',
            depositAddress: target,
            estimatedDepositChannelExpiryTime: Date.now() + 60_000,
        }))
        const sdk = {
            getChains: vi.fn(async () => [
                { chain: 'Ethereum', name: 'Ethereum', evmChainId: 1, isMainnet: true },
                { chain: 'Arbitrum', name: 'Arbitrum', evmChainId: 42161, isMainnet: true },
                { chain: 'Bitcoin', name: 'Bitcoin', evmChainId: undefined, isMainnet: true },
            ]),
            getAssets: vi.fn(async () => [
                {
                    chain: 'Ethereum',
                    symbol: 'USDC',
                    contractAddress: sourceToken,
                    isMainnet: true,
                },
                {
                    chain: 'Arbitrum',
                    symbol: 'USDC',
                    contractAddress: destinationToken,
                    isMainnet: true,
                },
            ]),
            getQuoteV2: vi.fn(async () => ({
                quotes: [{
                    type: 'REGULAR',
                    egressAmount: '900',
                    includedFees: [],
                    estimatedDurationSeconds: 30,
                    recommendedRetryDurationMinutes: 10,
                }],
            })),
            requestDepositAddressV2,
            getStatusV2: vi.fn(async () => ({
                state: 'SWAPPING',
                deposit: { txRef: `0x${'12'.repeat(32)}` },
            })),
        }
        const client = createChainflipSdkClient({
            network: 'mainnet',
            brokerApiUrl: null,
            brokerCommissionBps: 0,
        }, sdk as never)
        const chainflipRequest = {
            ...request,
            destinationAsset: {
                ...request.destinationAsset,
                chainId: 42161,
            },
        }
        const capabilities = await client.capabilities()
        expect(capabilities.routes).toHaveLength(2)
        const quote = await client.quote(chainflipRequest)
        expect(requestDepositAddressV2).not.toHaveBeenCalled()
        const prepared = await client.prepare(
            chainflipRequest,
            quote.statusId!,
        )
        expect(prepared.statusId).toBe('channel-1')
        expect(requestDepositAddressV2).toHaveBeenCalledTimes(1)
        expect((await client.status('channel-1')).status).toBe('in-flight')
        expect(mapChainflipStatus({ state: 'WAITING' } as never)).toBe('pending')
        expect(mapChainflipStatus({ state: 'RECEIVING' } as never)).toBe('source-confirming')
        expect(mapChainflipStatus({ state: 'SENT' } as never)).toBe('destination-confirming')
        expect(mapChainflipStatus({ state: 'COMPLETED' } as never)).toBe('completed')
        expect(mapChainflipStatus({ state: 'FAILED' } as never)).toBe('failed')
    })

    it('serves quote and prepare without accepting a frontend transaction target', async () => {
        const registry = new CrossChainRegistry([
            fixtureAdapter('across', '900'),
        ])
        const service = new CrossChainRouteService(
            registry,
            new MemoryCrossChainRouteRepository(),
        )
        const auth = createCrossChainAuthService({
            verifier: async () => true,
        })
        const app = Fastify()
        await app.register(createCrossChainRoutes(service, auth))

        const quoteResponse = await app.inject({
            method: 'POST',
            url: '/v1/cross-chain/quote',
            payload: request,
        })
        expect(quoteResponse.statusCode).toBe(200)
        const quote = quoteResponse.json().selectedRoute

        const challenge = await app.inject({
            method: 'POST',
            url: '/v1/cross-chain/auth/challenge',
            payload: { walletAddress: sender, chainId: 1 },
        })
        const verified = await app.inject({
            method: 'POST',
            url: '/v1/cross-chain/auth/verify',
            payload: {
                challengeId: challenge.json().challengeId,
                signature: `0x${'11'.repeat(65)}`,
            },
        })
        const authorization = `Bearer ${verified.json().sessionToken}`

        const prepareResponse = await app.inject({
            method: 'POST',
            url: `/v1/cross-chain/routes/${quote.routeId}/prepare`,
            headers: { authorization },
            payload: {
                account: sender,
                transaction: {
                    to: '0x0000000000000000000000000000000000000099',
                },
            },
        })
        expect(prepareResponse.statusCode).toBe(400)

        const validPrepare = await app.inject({
            method: 'POST',
            url: `/v1/cross-chain/routes/${quote.routeId}/prepare`,
            headers: { authorization },
            payload: {},
        })
        expect(validPrepare.statusCode).toBe(200)
        expect(validPrepare.json().preparedRoute.transaction.to).toBe(target)
        await app.close()
    })

    it('persists only public resumable data and enforces one source submission', async () => {
        const repository = new MemoryCrossChainRouteRepository()
        const route = await repository.create(fixtureQuote())
        const persisted = await repository.get(route.routeId)
        expect(persisted?.steps[0].transaction).toBeNull()
        expect(persisted?.feeAmountUsd).toBeNull()

        await repository.markPrepared(route.routeId, sender)
        const claimed = await repository.claimSubmission(route.routeId, sender)
        expect(claimed.submissionAttempts).toBe(1)
        await expect(
            repository.claimSubmission(route.routeId, sender),
        ).rejects.toMatchObject({ code: 'SOURCE_SUBMISSION_ALREADY_CLAIMED' })

        const hash = `0x${'ab'.repeat(32)}`
        const submitted = await repository.markSubmitted(route.routeId, sender, hash)
        const replay = await repository.markSubmitted(route.routeId, sender, hash)
        expect(submitted.status).toBe('source-submitted')
        expect(replay.sourceTransactionHash).toBe(hash)
        await expect(
            repository.markSubmitted(route.routeId, sender, `0x${'cd'.repeat(32)}`),
        ).rejects.toMatchObject({ code: 'SOURCE_SUBMISSION_NOT_CLAIMED' })
    })

    it('keeps source-confirmed routes incomplete until destination completion', async () => {
        const adapter = {
            ...fixtureAdapter('across', '900'),
            getStatus: async (statusId: string) => ({
                provider: 'across' as const,
                statusId,
                status: 'source-confirming' as const,
                sourceTransactionHash: `0x${'12'.repeat(32)}`,
                destinationTransactionHash: null,
            }),
        }
        const service = new CrossChainRouteService(
            new CrossChainRegistry([adapter]),
            new MemoryCrossChainRouteRepository(),
        )
        const quoted = await service.quote(request)
        const routeId = quoted.selectedRoute.routeId
        await service.prepare(routeId, sender)
        await service.claim(routeId, sender)
        await service.submitted(routeId, sender, `0x${'34'.repeat(32)}`)
        const status = await service.get(routeId)
        expect(status.status).toBe('source-confirmed')
        expect(status.status).not.toBe('completed')
    })

    it('prepares a deposit model without requiring EVM calldata', async () => {
        const base = fixtureAdapter('chainflip', '900')
        const adapter = {
            ...base,
            getQuote: async () => fixtureQuote({
                provider: 'chainflip',
                executionModel: 'deposit-channel',
                transaction: null,
                deposit: {
                    address: target,
                    asset: request.sourceAsset,
                    minimumAmount: request.amount,
                    expiresAt: new Date(Date.now() + 60_000).toISOString(),
                },
                steps: [{
                    id: 'deposit',
                    index: 0,
                    type: 'deposit',
                    label: 'Deposit source asset',
                    chainId: 1,
                    status: 'ready',
                    transaction: null,
                }],
            }),
        }
        const service = new CrossChainRouteService(
            new CrossChainRegistry([adapter]),
            new MemoryCrossChainRouteRepository(),
        )
        const quoted = await service.quote(request)
        const prepared = await service.prepare(quoted.selectedRoute.routeId, sender)
        expect(prepared.preparedRoute.executionModel).toBe('deposit-channel')
        expect(prepared.preparedRoute.transaction).toBeNull()
        expect(prepared.preparedRoute.deposit?.address).toBe(target)
    })
})
