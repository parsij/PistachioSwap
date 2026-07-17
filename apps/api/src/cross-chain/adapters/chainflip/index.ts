import { getApiConfig } from '../../../config.js'
import type {
    CrossChainAdapter,
    CrossChainQuote,
    CrossChainRequest,
    CrossChainStatusResult,
    ProviderCapabilities,
} from '../../types.js'
import {
    assertExactQuote,
    validateProviderTransaction,
} from '../../validation.js'
import { platformFeeIncompatibility } from '../../fees.js'
import { createChainflipSdkClient } from './sdk-client.js'

export interface ChainflipClient {
    capabilities(signal?: AbortSignal): Promise<ProviderCapabilities>
    quote(
        request: CrossChainRequest,
        signal?: AbortSignal,
    ): Promise<Omit<CrossChainQuote, 'quoteId' | 'transaction' | 'steps'> & {
        transaction?: unknown
    }>
    status(
        statusId: string,
        signal?: AbortSignal,
    ): Promise<CrossChainStatusResult>
    prepare(
        request: CrossChainRequest,
        statusId: string,
        signal?: AbortSignal,
    ): Promise<{
        statusId: string
        deposit: NonNullable<CrossChainQuote['deposit']>
    }>
}

class UnavailableChainflipClient implements ChainflipClient {
    async capabilities(): Promise<ProviderCapabilities> {
        return {
            provider: 'chainflip',
            available: false,
            fetchedAt: new Date().toISOString(),
            routes: [],
            reason: 'Chainflip SDK client is not configured.',
        }
    }

    async quote(): Promise<never> {
        throw new Error('Chainflip SDK client is not configured.')
    }

    async status(): Promise<never> {
        throw new Error('Chainflip SDK client is not configured.')
    }
    async prepare(): Promise<never> {
        throw new Error('Chainflip SDK client is not configured.')
    }
}

export function createChainflipAdapter(
    client?: ChainflipClient,
): CrossChainAdapter {
    const chainflipConfig = getApiConfig().crossChain.chainflip
    const enabled = chainflipConfig.enabled
    const resolvedClient = client ?? (enabled
        ? createChainflipSdkClient(chainflipConfig)
        : new UnavailableChainflipClient())

    return {
        name: 'chainflip',
        async getCapabilities(signal) {
            if (!enabled) {
                return {
                    provider: 'chainflip',
                    available: false,
                    fetchedAt: new Date().toISOString(),
                    routes: [],
                    reason: 'disabled',
                }
            }
            const incompatible = platformFeeIncompatibility('chainflip')
            if (incompatible) {
                return {
                    provider: 'chainflip',
                    available: false,
                    fetchedAt: new Date().toISOString(),
                    routes: [],
                    reason: incompatible,
                }
            }
            return resolvedClient.capabilities(signal)
        },
        async getQuote(request, capabilities, signal) {
            if (!enabled) throw new Error('Chainflip is disabled.')
            const quote = await resolvedClient.quote(request, signal)
            if (quote.executionModel === 'deposit-channel') {
                if (!request.walletCapabilities.depositChannel) {
                    throw new Error('Chainflip deposit channel is unavailable.')
                }
                return assertExactQuote({
                    ...quote,
                    transaction: null,
                    steps: [{
                        id: 'source-deposit',
                        index: 0,
                        type: 'deposit',
                        label: 'Deposit source asset',
                        chainId: request.sourceAsset.chainId,
                        status: 'ready',
                        transaction: null,
                    }],
                }, request)
            }
            const transaction = validateProviderTransaction(
                quote.transaction,
                request,
                capabilities,
            )
            return assertExactQuote({
                ...quote,
                transaction,
                steps: [{
                    id: 'source-transaction',
                    index: 0,
                    type: 'source-transaction',
                    label: 'Submit source transaction',
                    chainId: request.sourceAsset.chainId,
                    status: 'ready',
                    transaction,
                }],
            }, request)
        },
        async getStatus(statusId, signal) {
            if (!enabled) throw new Error('Chainflip is disabled.')
            return resolvedClient.status(statusId, signal)
        },
        async prepare(quote, signal) {
            if (quote.executionModel !== 'deposit-channel') return quote
            if (quote.deposit) return quote
            if (!quote.statusId) throw new Error('Chainflip quote reference is unavailable.')
            const prepared = await resolvedClient.prepare(
                quote.request,
                quote.statusId,
                signal,
            )
            return {
                ...quote,
                statusId: prepared.statusId,
                deposit: prepared.deposit,
            }
        },
    }
}
