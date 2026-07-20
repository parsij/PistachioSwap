import Fastify from 'fastify'
import { encodeFunctionData } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAcrossAdapter } from '../src/cross-chain/adapters/across/index.js'
import {
    createChainflipSdkClient,
    mapChainflipStatus,
} from '../src/cross-chain/adapters/chainflip/sdk-client.js'
import { createDebridgeAdapter } from '../src/cross-chain/adapters/debridge/index.js'
import {
    createRelayAdapter,
    normalizeRelayCosts,
} from '../src/cross-chain/adapters/relay/index.js'
import { createZeroXCrossChainAdapter } from '../src/cross-chain/adapters/zero-x/index.js'
import { createCrossChainAuthService } from '../src/cross-chain/auth.js'
import { CrossChainRegistry } from '../src/cross-chain/registry.js'
import { getPlatformFeeConfiguration } from '../src/cross-chain/fees.js'
import { MemoryCrossChainRouteRepository } from '../src/cross-chain/repository.js'
import { CrossChainRouteService, routeResponse } from '../src/cross-chain/service.js'
import type { HttpJson } from '../src/cross-chain/types.js'
import {
    CrossChainValidationError,
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

    beforeEach(() => {
        process.env.ACROSS_API_KEY = 'test-key'
        process.env.ACROSS_INTEGRATOR_ID = '0xdead'
    })

    afterEach(() => {
        process.env = { ...previousEnv }
    })

    it('normalizes Relay costs without double-counting combined fee fields', () => {
        const costs = normalizeRelayCosts({
            fees: {
                relayerService: { amountUsd: '0.02' },
                relayerGas: { amountUsd: '0.03' },
                relayer: { amountUsd: '999.99' },
                app: { amountUsd: '0.01' },
                subsidized: { amountUsd: '0.02' },
                expandedPriceImpact: {
                    execution: { usd: '-0.03' },
                    swap: { usd: '-0.04' },
                    relay: { usd: '-0.02' },
                    app: { usd: '-0.01' },
                    sponsored: { usd: '-0.02' },
                },
            },
        })

        expect(costs).toMatchObject({
            sourceGasUsd: null,
            destinationGasUsd: '0.03',
            providerFeeUsd: '0.02',
            appFeeUsd: '0.01',
            swapImpactUsd: '0.04',
            sponsoredUsd: '0.02',
            routeCostUsd: '0.08',
            totalEstimatedUsd: null,
            confidence: 'quote',
        })
    })

    it('falls back to narrow Relay fee fields and treats sponsorship as a reduction', () => {
        expect(normalizeRelayCosts({
            fees: {
                relayerService: { amountUsd: '0.02' },
                relayerGas: { amountUsd: '0.03' },
                relayer: { amountUsd: '0.05' },
                app: { amountUsd: '0.01' },
                subsidized: { amountUsd: '0.04' },
            },
        })).toMatchObject({
            destinationGasUsd: '0.03',
            providerFeeUsd: '0.02',
            appFeeUsd: '0.01',
            sponsoredUsd: '0.04',
            routeCostUsd: '0.02',
        })
    })

    it('preserves normalized partial costs in the public route response', async () => {
        const repository = new MemoryCrossChainRouteRepository()
        const route = await repository.create(fixtureQuote({
            provider: 'relay',
            costs: {
                sourceGasUsd: null,
                sourceGasNative: null,
                destinationGasUsd: '0.03',
                providerFeeUsd: '0.01',
                appFeeUsd: null,
                swapImpactUsd: null,
                sponsoredUsd: null,
                routeCostUsd: '0.04',
                totalEstimatedUsd: null,
                currency: 'USD',
                confidence: 'quote',
            },
            feeIncluded: true,
            costBreakdownAvailable: true,
        }))

        expect(routeResponse(route)).toMatchObject({
            provider: 'relay',
            feeIncluded: true,
            costBreakdownAvailable: true,
            costs: {
                destinationGasUsd: '0.03',
                providerFeeUsd: '0.01',
                routeCostUsd: '0.04',
                totalEstimatedUsd: null,
                confidence: 'quote',
            },
        })
    })

    it('fails closed when the in-memory route fallback reaches capacity', async () => {
        const repository = new MemoryCrossChainRouteRepository(1)
        await repository.create(fixtureQuote({ quoteId: 'first' }))
        await expect(repository.create(fixtureQuote({ quoteId: 'second' })))
            .rejects.toMatchObject({
                code: 'ROUTE_CAPACITY_REACHED',
                statusCode: 503,
            })
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

    it('classifies configuration, chain-pair, and token-pair failures', async () => {
        const adapter = fixtureAdapter('relay', '900')
        adapter.getCapabilities = async () => ({
            provider: 'relay',
            available: false,
            fetchedAt: new Date().toISOString(),
            routes: [],
            reason: 'not configured',
        })
        await expect(new CrossChainRegistry([adapter]).quote(request))
            .rejects.toMatchObject({ code: 'CROSS_CHAIN_NOT_CONFIGURED' })

        adapter.getCapabilities = async () => ({
            provider: 'relay',
            available: true,
            fetchedAt: new Date().toISOString(),
            routes: [{ sourceChainId: 56, destinationChainId: 1, transactionTargets: [target] }],
        })
        await expect(new CrossChainRegistry([adapter]).quote(request))
            .rejects.toMatchObject({ code: 'CROSS_CHAIN_UNSUPPORTED_CHAIN_PAIR' })

        adapter.getCapabilities = async () => ({
            provider: 'relay',
            available: true,
            fetchedAt: new Date().toISOString(),
            routes: [{
                sourceChainId: 1,
                destinationChainId: 8453,
                sellTokens: ['0x0000000000000000000000000000000000000099'],
                buyTokens: [destinationToken],
                transactionTargets: [target],
            }],
        })
        await expect(new CrossChainRegistry([adapter]).quote(request))
            .rejects.toMatchObject({ code: 'CROSS_CHAIN_UNSUPPORTED_TOKEN_PAIR' })
    })

    it('normalizes 0x Cross Chain separately and tracks its provider quote id', async () => {
        process.env.ZEROX_CROSS_CHAIN_ENABLED = 'true'
        process.env.ZEROX_API_KEY = 'test-key'
        process.env.PLATFORM_FEE_BPS = '0'
        const sourceHash = `0x${'1'.repeat(64)}`
        const destinationHash = `0x${'2'.repeat(64)}`
        const urls: string[] = []
        const http: HttpJson = async (url) => {
            urls.push(url.toString())
            if (url.pathname === '/cross-chain/sources') {
                return { sources: [{ chainId: 1 }, { chainId: 8453 }] }
            }
            if (url.pathname === '/cross-chain/status') {
                return { status: 'completed', destinationTxHash: destinationHash }
            }
            return {
                quotes: [{
                    quoteId: 'provider-quote-123',
                    originChain: 1,
                    destinationChain: 8453,
                    sellToken: sourceToken,
                    buyToken: destinationToken,
                    sellAmount: '1000',
                    buyAmount: '950',
                    minimumBuyAmount: '940',
                    allowanceTarget: target,
                    transaction: {
                        details: { to: relaySpender, data: '0x1234', value: '0' },
                    },
                    estimatedTimeSeconds: 120,
                }],
            }
        }
        const adapter = createZeroXCrossChainAdapter(http)
        const capabilities = await adapter.getCapabilities()
        const quote = await adapter.getQuote(request, capabilities)

        expect(quote).toMatchObject({
            provider: '0x-cross-chain',
            buyAmount: '950',
            minimumBuyAmount: '940',
            statusId: '1:provider-quote-123',
            transaction: { to: relaySpender, allowanceTarget: target },
        })
        expect(quote.quoteId).not.toBe('provider-quote-123')
        expect(quote.steps.map((step) => step.type)).toEqual([
            'approval',
            'source-transaction',
            'wait',
            'destination',
        ])

        const status = await adapter.getStatus(quote.statusId!, undefined, sourceHash)
        expect(status).toMatchObject({
            status: 'completed',
            sourceTransactionHash: sourceHash,
            destinationTransactionHash: destinationHash,
        })
        expect(urls.some((url) => url.includes('/swap/'))).toBe(false)
        expect(urls.some((url) => url.includes('/cross-chain/quotes'))).toBe(true)
        expect(urls.some((url) => url.includes('originTxHash='))).toBe(true)
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

    it('omits zero provider gas sentinels and normalizes positive hex gas estimates', () => {
        const capabilities = {
            provider: 'across' as const,
            available: true,
            fetchedAt: new Date().toISOString(),
            routes: [{
                sourceChainId: 1,
                destinationChainId: 8453,
                transactionTargets: [target],
            }],
        }

        expect(validateProviderTransaction({
            chainId: 1,
            to: target,
            data: '0x1234',
            value: '0',
            gas: '0',
        }, request, capabilities)).not.toHaveProperty('gasEstimate')

        expect(validateProviderTransaction({
            chainId: 1,
            to: target,
            data: '0x1234',
            value: '0',
            gasLimit: '0x5208',
        }, request, capabilities)).toMatchObject({
            gasEstimate: '21000',
        })
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
        const adapter = createAcrossAdapter(async (url) => {
            if (url.pathname.endsWith('/swap/approval')) {
                expect(url.searchParams.get('tradeType')).toBe('exactInput')
            }
            return url.pathname.endsWith('/swap/tokens')
                ? [{
                      chainId: 1, address: sourceToken,
                  }, { chainId: 8453, address: destinationToken }]
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
                  }
        })
        const quote = await adapter.getQuote(request, await adapter.getCapabilities())
        expect(quote.steps.map(({ type, index }) => [type, index])).toEqual([
            ['approval', 0],
            ['source-transaction', 1],
        ])
        expect(quote.steps[0]?.transaction?.allowanceTarget).toBe(target)
    })

    it('rejects an Across expected allowance above the exact-input cap', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const adapter = createAcrossAdapter(async (url) => url.pathname.endsWith('/swap/tokens')
            ? [{ chainId: 1, address: sourceToken }, { chainId: 8453, address: destinationToken }]
            : {
                  expectedOutputAmount: '900',
                  checks: { allowance: { token: sourceToken, spender: target, actual: '0', expected: '1001' } },
                  approvalTxns: [{ chainId: 1, to: sourceToken, data: approvalData(target, 1001n), value: '0' }],
                  steps: { bridge: { tokenIn: { address: sourceToken }, inputAmount: '1001' } },
                  swapTx: { chainId: 1, to: target, data: '0x1234', value: '0' },
              })
        await expect(adapter.getQuote(request, await adapter.getCapabilities()))
            .rejects.toMatchObject({ code: 'ACROSS_APPROVAL_AMOUNT_INVALID' })
    })

    it('replaces an Across provider max approval with exact allowance metadata', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const adapter = createAcrossAdapter(async (url) => url.pathname.endsWith('/swap/tokens')
            ? [{ chainId: 1, address: sourceToken }, { chainId: 8453, address: destinationToken }]
            : {
                  expectedOutputAmount: '900',
                  checks: { allowance: { token: sourceToken, spender: target, actual: '0', expected: '1000' } },
                  approvalTxns: [{ chainId: 1, to: sourceToken, data: approvalData(relaySpender, (2n ** 256n) - 1n), value: '0' }],
                  swapTx: { chainId: 1, to: target, data: '0x1234', value: '0' },
              })
        const quote = await adapter.getQuote(request, await adapter.getCapabilities())
        expect(quote.steps[0]?.transaction).toMatchObject({
            chainId: 1,
            to: sourceToken,
            allowanceTarget: target,
            data: approvalData(target, 1000n),
            value: '0',
        })
    })

    it('omits Across approval when allowance is already sufficient', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const adapter = createAcrossAdapter(async (url) => url.pathname.endsWith('/swap/tokens')
            ? [{ chainId: 1, address: sourceToken }, { chainId: 8453, address: destinationToken }]
            : {
                  expectedOutputAmount: '900',
                  checks: { allowance: { token: sourceToken, spender: target, actual: '1000', expected: '1000' } },
                  approvalTxns: [{ chainId: 1, to: sourceToken, data: approvalData(target, (2n ** 256n) - 1n), value: '0' }],
                  swapTx: { chainId: 1, to: target, data: '0x1234', value: '0' },
              })
        const quote = await adapter.getQuote(request, await adapter.getCapabilities())
        expect(quote.steps.map((step) => step.type)).toEqual(['source-transaction'])
    })

    it('uses Across authoritative expected allowance instead of a stale request amount', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const adapter = createAcrossAdapter(async (url) =>
            url.pathname.endsWith('/swap/tokens')
                ? [{ chainId: 1, address: sourceToken }, { chainId: 8453, address: destinationToken }]
                : {
                      expectedOutputAmount: '900',
                      minOutputAmount: '890',
                      checks: { allowance: {
                          token: sourceToken,
                          spender: target,
                          actual: '0',
                          expected: '999',
                      } },
                      approvalTxns: [{
                          chainId: 1,
                          to: sourceToken,
                          data: approvalData(target, 999n),
                          value: '0',
                      }],
                      steps: { originSwap: { tokenIn: { address: sourceToken }, inputAmount: '999' } },
                      swapTx: { chainId: 1, to: target, data: '0x1234', value: '0' },
                  })

        const quote = await adapter.getQuote(request, await adapter.getCapabilities())
        expect(quote.steps[0]?.type).toBe('approval')
        expect(quote.steps[0]?.transaction?.data).toBe(approvalData(target, 999n))
    })

    it('uses Across validation codes and rejects unlimited approval', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const adapter = createAcrossAdapter(async (url) =>
            url.pathname.endsWith('/swap/tokens')
                ? [{ chainId: 1, address: sourceToken }, { chainId: 8453, address: destinationToken }]
                : {
                      expectedOutputAmount: '900',
                      checks: { allowance: {
                          token: sourceToken,
                          spender: target,
                          actual: '0',
                          expected: String((2n ** 256n) - 1n),
                      } },
                      approvalTxns: [],
                      swapTx: { chainId: 1, to: target, data: '0x1234', value: '0' },
                  })

        await expect(adapter.getQuote(request, await adapter.getCapabilities()))
            .rejects.toMatchObject({ code: 'ACROSS_APPROVAL_AMOUNT_INVALID' })
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
            url.pathname.endsWith('/swap/tokens')
                ? [{
                      chainId: 1, address: nativeRequest.sourceAsset.address,
                  }, { chainId: 8453, address: destinationToken }]
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
            if (url.pathname.endsWith('/swap/tokens')) return [
                { chainId: 1, address: sourceToken },
                { chainId: 8453, address: destinationToken },
            ]
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
                          {
                              id: 1,
                              contracts: {
                                  approvalProxy: relaySpender,
                                  erc20Router: target,
                              },
                          },
                          {
                              id: 8453,
                              contracts: { erc20Router: destinationToken },
                          },
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
                                      gas: '60000',
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
                                      gas: '65000',
                                  },
                              }],
                          },
                      ],
                      details: {
                          timeEstimate: 15,
                          recipient: sender,
                          currencyOut: {
                              amount: '900',
                              minimumAmount: '890',
                              currency: {
                                  chainId: 8453,
                                  address: destinationToken,
                              },
                          },
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
        expect(quote.steps.map((step) => step.transaction?.gasEstimate)).toEqual([
            '60000',
            '65000',
        ])
        expect(relayBody!.appFees).toEqual([{ recipient: sender, fee: '45' }])
        expect(quote.fees.filter(({ type }) => type === 'platform')).toEqual([
            expect.objectContaining({ amount: '4' }),
        ])
    })

    it('validates Relay v2 approval calldata against the source-chain Depository', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const bnbUsdt = '0x55d398326f99059ff775485246999027b3197955'
        const celoUsdt = '0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e'
        const depository = '0x4cd00e387622c35bddb9b4c962c136462338bc31'
        const bnbToCelo = {
            ...request,
            sourceAsset: { chainId: 56, address: bnbUsdt, symbol: 'USDT', decimals: 18 },
            destinationAsset: { chainId: 42220, address: celoUsdt, symbol: 'USDT', decimals: 6 },
            amount: '1000000000000000000',
        }
        const http: HttpJson = async (url) => url.pathname.endsWith('/chains')
            ? {
                  chains: [56, 42220].map((id) => ({
                      id,
                      contracts: {},
                      protocol: { v2: { depository } },
                  })),
              }
            : {
                  steps: [
                      {
                          id: 'authorize1',
                          items: [{
                              data: {
                                  chainId: 56,
                                  to: bnbUsdt,
                                  data: approvalData(depository, 1_000_000_000_000_000_000n),
                                  value: '0',
                              },
                          }],
                      },
                      {
                          id: 'deposit',
                          requestId: 'bnb-celo-relay',
                          items: [{
                              data: {
                                  chainId: 56,
                                  from: sender,
                                  to: depository,
                                  data: '0x1234',
                                  value: '0',
                              },
                          }],
                      },
                  ],
                  details: {
                      recipient: sender,
                      destinationChainId: 42220,
                      currencyOut: {
                          amount: '999000',
                          minimumAmount: '990000',
                          currency: { chainId: 42220, address: celoUsdt },
                      },
                  },
                  fees: {},
              }
        const adapter = createRelayAdapter(http)
        const quote = await adapter.getQuote(bnbToCelo, await adapter.getCapabilities())

        expect(quote.steps[0]?.transaction).toMatchObject({
            to: bnbUsdt,
            allowanceTarget: depository,
        })
        expect(quote.steps[1]?.transaction?.to).toBe(depository)
        expect(quote.request.destinationAsset.address).toBe(celoUsdt)
        expect(quote.statusId).toBe('bnb-celo-relay')
    })

    it('rejects a Relay v2 spender that differs from the authoritative Depository', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const depository = '0x4cd00e387622c35bddb9b4c962c136462338bc31'
        const http: HttpJson = async (url) => url.pathname.endsWith('/chains')
            ? {
                  chains: [1, 8453].map((id) => ({
                      id,
                      contracts: {},
                      protocol: { v2: { depository } },
                  })),
              }
            : {
                  steps: [
                      {
                          id: 'approval',
                          items: [{ data: {
                              chainId: 1,
                              to: sourceToken,
                              data: approvalData(relaySpender),
                              value: '0',
                          } }],
                      },
                      {
                          id: 'deposit',
                          items: [{ data: {
                              chainId: 1,
                              to: depository,
                              data: '0x1234',
                              value: '0',
                          } }],
                      },
                  ],
                  details: {
                      recipient: sender,
                      currencyOut: {
                          amount: '900',
                          minimumAmount: '890',
                          currency: { chainId: 8453, address: destinationToken },
                      },
                  },
                  fees: {},
              }
        const adapter = createRelayAdapter(http)
        await expect(adapter.getQuote(request, await adapter.getCapabilities()))
            .rejects.toMatchObject({ code: 'RELAY_APPROVAL_TARGET_INVALID' })
    })

    it('does not mix Relay v2 Depository authority with legacy ApprovalProxy flows', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const depository = '0x4cd00e387622c35bddb9b4c962c136462338bc31'
        const legacyRouter = target
        const http: HttpJson = async (url) => url.pathname.endsWith('/chains')
            ? {
                  chains: [1, 8453].map((id) => ({
                      id,
                      contracts: {
                          erc20Router: legacyRouter,
                          approvalProxy: relaySpender,
                      },
                      protocol: { v2: { depository } },
                  })),
              }
            : {
                  steps: [
                      {
                          id: 'approval',
                          items: [{ data: {
                              chainId: 1,
                              to: sourceToken,
                              data: approvalData(depository),
                              value: '0',
                          } }],
                      },
                      {
                          id: 'deposit',
                          items: [{ data: {
                              chainId: 1,
                              to: legacyRouter,
                              data: '0x1234',
                              value: '0',
                          } }],
                      },
                  ],
                  details: {
                      recipient: sender,
                      currencyOut: {
                          amount: '900',
                          minimumAmount: '890',
                          currency: { chainId: 8453, address: destinationToken },
                      },
                  },
                  fees: {},
              }
        const adapter = createRelayAdapter(http)
        await expect(adapter.getQuote(request, await adapter.getCapabilities()))
            .rejects.toMatchObject({ code: 'RELAY_APPROVAL_TARGET_INVALID' })
    })

    it('returns RELAY_AUTHORITY_UNAVAILABLE when the selected flow lacks authority metadata', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const http: HttpJson = async (url) => url.pathname.endsWith('/chains')
            ? {
                  chains: [1, 8453].map((id) => ({
                      id,
                      contracts: { erc20Router: target },
                  })),
              }
            : {
                  steps: [
                      {
                          id: 'approve',
                          items: [{ data: {
                              chainId: 1,
                              to: sourceToken,
                              data: approvalData(relaySpender),
                              value: '0',
                          } }],
                      },
                      {
                          id: 'deposit',
                          items: [{ data: {
                              chainId: 1,
                              to: target,
                              data: '0x1234',
                              value: '0',
                          } }],
                      },
                  ],
                  details: {
                      recipient: sender,
                      currencyOut: {
                          amount: '900',
                          minimumAmount: '890',
                          currency: { chainId: 8453, address: destinationToken },
                      },
                  },
                  fees: {},
              }
        const adapter = createRelayAdapter(http)
        await expect(adapter.getQuote(request, await adapter.getCapabilities()))
            .rejects.toMatchObject({ code: 'RELAY_AUTHORITY_UNAVAILABLE' })
    })

    it('validates Relay v3 router and approval proxy independently', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const v3Router = '0x0000000000000000000000000000000000000007'
        const v3Proxy = '0x0000000000000000000000000000000000000008'
        const adapter = createRelayAdapter(async (url) => url.pathname.endsWith('/chains')
            ? { chains: [1, 8453].map((id) => ({ id, contracts: { v3: { erc20Router: v3Router, approvalProxy: v3Proxy } } })) }
            : {
                  steps: [
                      { id: 'approve', items: [{ data: { chainId: 1, to: sourceToken, data: approvalData(v3Proxy), value: '0' } }] },
                      { id: 'deposit', items: [{ data: { chainId: 1, to: v3Router, data: '0x1234', value: '0' } }] },
                  ],
                  details: { recipient: sender, currencyOut: { amount: '900', minimumAmount: '890', currency: { chainId: 8453, address: destinationToken } } }, fees: {},
              })
        const quote = await adapter.getQuote(request, await adapter.getCapabilities())
        expect(quote.steps.map((step) => step.transaction?.to)).toEqual([sourceToken, v3Router])
    })

    it('accepts Relay v3 ApprovalProxy source execution only after its matching approval', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const v3Proxy = '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be'
        const adapter = createRelayAdapter(async (url) => url.pathname.endsWith('/chains')
            ? { chains: [1, 8453].map((id) => ({ id, contracts: { v3: { approvalProxy: v3Proxy } } })) }
            : {
                  steps: [
                      { id: 'approve', items: [{ data: { chainId: 1, to: sourceToken, data: approvalData(v3Proxy), value: '0' } }] },
                      { id: 'deposit', items: [{ data: { chainId: 1, to: v3Proxy, data: '0x1234', value: '0' } }] },
                  ],
                  details: { recipient: sender, currencyOut: { amount: '900', minimumAmount: '890', currency: { chainId: 8453, address: destinationToken } } }, fees: {},
              })
        const quote = await adapter.getQuote(request, await adapter.getCapabilities())
        expect(quote.steps.map((step) => step.transaction?.to)).toEqual([sourceToken, v3Proxy])
    })

    it('accepts Relay ApprovalProxy execution when sufficient allowance omits the approval step', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const v3Proxy = '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be'
        const adapter = createRelayAdapter(async (url) => url.pathname.endsWith('/chains')
            ? { chains: [1, 8453].map((id) => ({ id, contracts: { v3: { approvalProxy: v3Proxy } } })) }
            : {
                  steps: [
                      { id: 'deposit', items: [{ data: { chainId: 1, to: v3Proxy, data: '0x1234', value: '0' } }] },
                  ],
                  details: { recipient: sender, currencyOut: { amount: '900', minimumAmount: '890', currency: { chainId: 8453, address: destinationToken } } }, fees: {},
              })
        const quote = await adapter.getQuote(request, await adapter.getCapabilities())
        expect(quote.steps.map((step) => step.transaction?.to)).toEqual([v3Proxy])
    })

    it('rejects Relay ApprovalProxy authority supplied only by another chain', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const v3Proxy = '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be'
        const adapter = createRelayAdapter(async (url) => url.pathname.endsWith('/chains')
            ? { chains: [
                { id: 1, contracts: { erc20Router: target, approvalProxy: relaySpender } },
                { id: 8453, contracts: { v3: { approvalProxy: v3Proxy } } },
            ] }
            : {
                  steps: [
                      { id: 'approve', items: [{ data: { chainId: 1, to: sourceToken, data: approvalData(v3Proxy), value: '0' } }] },
                      { id: 'deposit', items: [{ data: { chainId: 1, to: v3Proxy, data: '0x1234', value: '0' } }] },
                  ],
                  details: { recipient: sender, currencyOut: { amount: '900', minimumAmount: '890', currency: { chainId: 8453, address: destinationToken } } }, fees: {},
              })
        await expect(adapter.getQuote(request, await adapter.getCapabilities()))
            .rejects.toMatchObject({ code: 'RELAY_APPROVAL_TARGET_INVALID' })
    })

    it('does not return Relay destination transaction metadata as a wallet step', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const adapter = createRelayAdapter(async (url) => url.pathname.endsWith('/chains')
            ? { chains: [1, 8453].map((id) => ({ id, contracts: { erc20Router: target, approvalProxy: relaySpender } })) }
            : {
                  steps: [
                      { id: 'approve', items: [{ data: { chainId: 1, to: sourceToken, data: approvalData(relaySpender), value: '0' } }] },
                      { id: 'deposit', items: [{ data: { chainId: 1, to: target, data: '0x1234', value: '0' } }] },
                      { id: 'destination', items: [{ data: { chainId: 8453, to: destinationToken, data: '0x1234', value: '0' } }] },
                  ],
                  details: { recipient: sender, currencyOut: { amount: '900', minimumAmount: '890', currency: { chainId: 8453, address: destinationToken } } }, fees: {},
              })
        const quote = await adapter.getQuote(request, await adapter.getCapabilities())
        expect(quote.steps).toHaveLength(2)
        expect(quote.steps.every((step) => step.chainId === 1)).toBe(true)
    })

    it('rejects Relay solver and unknown transaction targets even when listed elsewhere in metadata', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const solver = '0x0000000000000000000000000000000000000009'
        const adapter = createRelayAdapter(async (url) => url.pathname.endsWith('/chains')
            ? { chains: [1, 8453].map((id) => ({ id, contracts: { erc20Router: target, approvalProxy: relaySpender }, solverAddresses: [solver] })) }
            : {
                  steps: [{ id: 'deposit', items: [{ data: { chainId: 1, to: solver, data: '0x1234', value: '0' } }] }],
                  details: { recipient: sender, currencyOut: { amount: '900', minimumAmount: '890', currency: { chainId: 8453, address: destinationToken } } }, fees: {},
              })
        await expect(adapter.getQuote(request, await adapter.getCapabilities()))
            .rejects.toMatchObject({ code: 'RELAY_ROUTE_MALFORMED' })
    })

    it('categorizes tiny provider minimum failures as amount-too-low', async () => {
        const across = fixtureAdapter('across', '900')
        const relay = fixtureAdapter('relay', '900')
        across.getQuote = async () => { throw new Error('amount below minimum amount') }
        relay.getQuote = async () => { throw new Error('amount too low') }
        await expect(new CrossChainRegistry([across, relay]).quote({ ...request, amount: '12' }))
            .rejects.toMatchObject({ code: 'CROSS_CHAIN_AMOUNT_TOO_LOW' })
    })

    it('keeps eligible and attempted provider diagnostics consistent on total failure', async () => {
        const relay = fixtureAdapter('relay', '900')
        relay.getQuote = async () => {
            throw new Error('no route')
        }
        await expect(new CrossChainRegistry([relay]).quote(request)).rejects.toMatchObject({
            eligibleProviders: ['relay'],
            attemptedProviders: ['relay'],
            failures: [{ provider: 'relay', code: 'NO_LIQUIDITY' }],
        })
    })

    it('preserves another provider route when Relay validation fails', async () => {
        const across = fixtureAdapter('across', '900')
        const relay = fixtureAdapter('relay', '950')
        relay.getQuote = async () => {
            throw new Error('Relay returned a malformed route.')
        }
        const result = await new CrossChainRegistry([across, relay]).quote(request)

        expect(result.quotes.map(({ provider }) => provider)).toEqual(['across'])
        expect(result.eligibleProviders).toEqual(['across', 'relay'])
        expect(result.attemptedProviders).toEqual(['across', 'relay'])
        expect(result.failures).toEqual([expect.objectContaining({ provider: 'relay' })])
    })

    it('preserves a successful Relay route when Across validation fails', async () => {
        const across = fixtureAdapter('across', '950')
        const relay = fixtureAdapter('relay', '900')
        across.getQuote = async () => {
            throw new CrossChainValidationError(
                'ACROSS_APPROVAL_AMOUNT_INVALID',
                'Across returned an invalid approval amount.',
            )
        }
        const result = await new CrossChainRegistry([across, relay]).quote(request)

        expect(result.quotes.map(({ provider }) => provider)).toEqual(['relay'])
        expect(result.failures).toEqual([{
            provider: 'across',
            code: 'ACROSS_APPROVAL_AMOUNT_INVALID',
            reason: 'Across returned an invalid approval amount.',
        }])
    })

    it('fails closed when Across returns a different destination token', async () => {
        process.env.PLATFORM_FEE_BPS = '0'
        const malicious = '0x0000000000000000000000000000000000000099'
        const adapter = createAcrossAdapter(async (url) =>
            url.pathname.endsWith('/swap/tokens')
                ? [{
                      chainId: 1, address: sourceToken,
                  }, { chainId: 8453, address: destinationToken }]
                : {
                      expectedOutputAmount: '900',
                      minOutputAmount: '890',
                      outputToken: malicious,
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
        ).rejects.toThrow('different destination token')
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

    it('returns 200 from routes when one eligible provider succeeds', async () => {
        const across = fixtureAdapter('across', '900')
        const relay = fixtureAdapter('relay', '900')
        across.getQuote = async () => {
            throw new CrossChainValidationError(
                'ACROSS_APPROVAL_AMOUNT_INVALID',
                'Across returned an invalid approval amount.',
            )
        }
        const app = Fastify()
        await app.register(createCrossChainRoutes(
            new CrossChainRouteService(
                new CrossChainRegistry([across, relay]),
                new MemoryCrossChainRouteRepository(),
            ),
            createCrossChainAuthService({ verifier: async () => true }),
        ))
        const response = await app.inject({
            method: 'POST',
            url: '/v1/cross-chain/routes',
            payload: request,
        })
        expect(response.statusCode).toBe(200)
        expect(response.json().selectedRoute.provider).toBe('relay')
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
