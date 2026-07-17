import { randomUUID } from 'node:crypto'

import {
    SwapSDK,
    type AssetData,
    type ChainData,
    type Quote,
    type SwapStatusResponseV2,
} from '@chainflip/sdk/swap'

import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../../../lib/address.js'
import { bpsAsPercent, getPlatformFeeConfiguration } from '../../fees.js'
import type {
    CrossChainRequest,
    CrossChainStatus,
} from '../../types.js'
import type { ChainflipClient } from './index.js'

type ChainflipSdkBoundary = Pick<
    SwapSDK,
    'getChains' | 'getAssets' | 'getQuoteV2' | 'getStatusV2' | 'requestDepositAddressV2'
>

type Config = {
    network: string
    brokerApiUrl: string | null
    brokerCommissionBps: number
}

export function createChainflipSdkClient(
    config: Config,
    sdk: ChainflipSdkBoundary = new SwapSDK({
        network: 'mainnet',
        ...(config.brokerApiUrl ? { broker: { url: config.brokerApiUrl } } : {}),
    }),
): ChainflipClient {
    if (config.network !== 'mainnet') {
        throw new Error('Chainflip SDK must use mainnet.')
    }
    const quotes = new Map<string, { quote: Quote; request: CrossChainRequest }>()
    let catalog: Promise<{ chains: ChainData[]; assets: AssetData[] }> | null = null

    const getCatalog = async (signal?: AbortSignal) => {
        abortIfNeeded(signal)
        catalog ??= Promise.all([
            sdk.getChains(),
            sdk.getAssets(),
        ]).then(([chains, assets]) => ({ chains, assets }))
        const result = await catalog
        abortIfNeeded(signal)
        return result
    }

    return {
        async capabilities(signal) {
            const { chains, assets } = await getCatalog(signal)
            const evmChains = chains.filter((chain) =>
                chain.isMainnet && Number.isInteger(chain.evmChainId),
            )
            const routes = evmChains.flatMap((source) => {
                const sourceAssets = assets
                    .filter((asset) => asset.chain === source.chain && asset.isMainnet)
                    .map(assetAddress)
                    .filter((value): value is string => Boolean(value))
                return evmChains
                    .filter((destination) => destination.chain !== source.chain)
                    .map((destination) => ({
                        sourceChainId: source.evmChainId!,
                        destinationChainId: destination.evmChainId!,
                        sellTokens: sourceAssets,
                        buyTokens: assets
                            .filter((asset) =>
                                asset.chain === destination.chain && asset.isMainnet,
                            )
                            .map(assetAddress)
                            .filter((value): value is string => Boolean(value)),
                        transactionTargets: [],
                    }))
            })
            return {
                provider: 'chainflip',
                available: routes.length > 0,
                fetchedAt: new Date().toISOString(),
                routes,
                ...(routes.length ? {} : { reason: 'No EVM-only Chainflip routes are available.' }),
            }
        },

        async quote(request, signal) {
            getPlatformFeeConfiguration('chainflip')
            const { chains, assets } = await getCatalog(signal)
            const source = findSdkAsset(chains, assets, request.sourceAsset)
            const destination = findSdkAsset(chains, assets, request.destinationAsset)
            const response = await sdk.getQuoteV2({
                srcChain: source.chain,
                srcAsset: source.symbol,
                destChain: destination.chain,
                destAsset: destination.symbol,
                amount: request.amount,
                brokerCommissionBps: config.brokerCommissionBps,
                isVaultSwap: false,
            }, { signal })
            const quote = response.quotes[0]
            if (!quote) throw new Error('Chainflip returned no quote.')
            const reference = randomUUID()
            quotes.set(reference, { quote, request })
            const minimumBuyAmount = (
                BigInt(quote.egressAmount) *
                BigInt(10_000 - request.slippageBps) /
                10_000n
            ).toString()
            return {
                provider: 'chainflip',
                request,
                buyAmount: quote.egressAmount,
                minimumBuyAmount,
                fees: quote.includedFees.map((fee) => ({
                    type: fee.type === 'BROKER' ? 'provider' as const : 'bridge' as const,
                    token: request.sourceAsset.address,
                    amount: fee.amount,
                    includedInQuote: true,
                })),
                estimatedDurationSeconds: quote.estimatedDurationSeconds,
                executionModel: 'deposit-channel',
                transaction: undefined,
                deposit: null,
                statusId: reference,
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
            }
        },

        async prepare(request, statusId, signal) {
            abortIfNeeded(signal)
            const held = quotes.get(statusId)
            if (!held || held.request.ownerAddress !== request.ownerAddress) {
                throw new Error('Chainflip quote is unknown or expired.')
            }
            const response = await sdk.requestDepositAddressV2({
                quote: held.quote,
                srcAddress: request.ownerAddress,
                destAddress: request.recipient,
                fillOrKillParams: {
                    slippageTolerancePercent: bpsAsPercent(request.slippageBps),
                    retryDurationMinutes: held.quote.recommendedRetryDurationMinutes,
                    refundAddress: request.ownerAddress,
                },
                brokerCommissionBps: config.brokerCommissionBps,
            })
            abortIfNeeded(signal)
            quotes.delete(statusId)
            const expiryValue = response.estimatedDepositChannelExpiryTime
            const expiryMilliseconds = expiryValue && expiryValue < 1_000_000_000_000
                ? expiryValue * 1000
                : expiryValue
            const expiresAt = expiryMilliseconds
                ? new Date(expiryMilliseconds).toISOString()
                : new Date(Date.now() + 60_000).toISOString()
            return {
                statusId: response.depositChannelId,
                deposit: {
                    address: response.depositAddress,
                    asset: request.sourceAsset,
                    minimumAmount: request.amount,
                    expiresAt,
                },
            }
        },

        async status(statusId, signal) {
            const response = await sdk.getStatusV2({ id: statusId }, { signal })
            return {
                provider: 'chainflip',
                statusId,
                status: mapChainflipStatus(response),
                sourceTransactionHash:
                    'deposit' in response ? response.deposit.txRef ?? null : null,
                destinationTransactionHash:
                    'swapEgress' in response
                        ? response.swapEgress?.txRef ?? null
                        : null,
            }
        },
    }
}

function assetAddress(asset: AssetData) {
    return asset.contractAddress
        ? normalizeAddress(asset.contractAddress)
        : NATIVE_TOKEN_ADDRESS
}

function findSdkAsset(
    chains: ChainData[],
    assets: AssetData[],
    requested: CrossChainRequest['sourceAsset'],
) {
    const chain = chains.find((candidate) =>
        candidate.isMainnet && candidate.evmChainId === requested.chainId,
    )
    const asset = chain && assets.find((candidate) =>
        candidate.chain === chain.chain &&
        candidate.isMainnet &&
        assetAddress(candidate) === requested.address,
    )
    if (!asset) throw new Error('Asset is not supported by Chainflip.')
    return asset
}

export function mapChainflipStatus(
    response: Pick<SwapStatusResponseV2, 'state'>,
): CrossChainStatus {
    switch (response.state) {
        case 'WAITING':
            return 'pending'
        case 'RECEIVING':
            return 'source-confirming'
        case 'SWAPPING':
            return 'in-flight'
        case 'SENDING':
        case 'SENT':
            return 'destination-confirming'
        case 'COMPLETED':
            return 'completed'
        case 'FAILED':
            return 'failed'
    }
}

function abortIfNeeded(signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason ?? new Error('Request aborted.')
}
