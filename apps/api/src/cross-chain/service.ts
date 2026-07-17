import { normalizeAddress } from '../lib/address.js'
import { CrossChainRegistry } from './registry.js'
import {
    createCrossChainRouteRepository,
    type CrossChainRouteRepository,
    routeError,
} from './repository.js'
import type {
    CrossChainProviderName,
    CrossChainRequest,
    CrossChainStatus,
    PublicCrossChainRoute,
    PublicRouteState,
} from './types.js'

export class CrossChainRouteService {
    constructor(
        private readonly registry = new CrossChainRegistry(),
        private readonly repository: CrossChainRouteRepository =
            createCrossChainRouteRepository(),
    ) {}

    providerNames() {
        return this.registry.providerNames()
    }

    async getProviderSummaries(signal?: AbortSignal) {
        return Promise.all(this.providerNames().map(async (provider) => {
            try {
                return publicCapabilities(
                    await this.registry.getCapabilities(provider, signal),
                )
            } catch {
                return {
                    providerId: provider,
                    available: false,
                    stale: false,
                    reason: 'Provider capability discovery is unavailable.',
                }
            }
        }))
    }

    async getCapabilities(provider: CrossChainProviderName, signal?: AbortSignal) {
        return publicCapabilities(
            await this.registry.getCapabilities(provider, signal),
        )
    }

    async quote(request: CrossChainRequest, signal?: AbortSignal) {
        const result = await this.registry.quote(request, signal)
        const routes = await Promise.all(result.quotes.map((quote) =>
            this.repository.create(quote),
        ))
        const selected = routes.find((route) =>
            route.quoteId === result.selectedQuote.quoteId,
        )!
        return {
            selectedRoute: routeResponse(selected),
            routes: routes.map(routeResponse),
            failures: result.failures.map((failure) => ({
                ...failure,
                code: providerErrorCode(failure.provider, 'NO_ROUTE'),
            })),
        }
    }

    async prepare(routeId: string, ownerValue: unknown, sourceChainId?: number) {
        routeId = requireRouteId(routeId)
        const ownerAddress = requireOwner(ownerValue)
        if (sourceChainId !== undefined) {
            await this.requireAuthenticationScope(routeId, ownerAddress, sourceChainId)
        }
        let route = await this.repository.markPrepared(routeId, ownerAddress)
        const quote = await this.registry.prepare(route.quoteId)
        if (quote.request.ownerAddress !== ownerAddress) {
            throw routeError('ROUTE_OWNER_MISMATCH', 'Route belongs to another owner.')
        }
        if (
            quote.statusId &&
            (
                quote.statusId !== route.providerTrackingId ||
                quote.deposit?.expiresAt !== undefined
            )
        ) {
            route = await this.repository.setPreparedProviderReference(
                routeId,
                quote.statusId,
                quote.deposit?.expiresAt ?? quote.expiresAt,
            )
        }
        return {
            preparedRoute: {
                ...routeResponse(route),
                steps: quote.steps,
                transaction: quote.transaction,
                deposit: quote.deposit,
            },
        }
    }

    async get(routeId: string, signal?: AbortSignal) {
        routeId = requireRouteId(routeId)
        let route = await this.repository.get(routeId)
        if (!route) throw routeError('ROUTE_NOT_FOUND', 'Route was not found.')
        if (
            route.providerTrackingId &&
            !['quoted', 'prepared', 'awaiting-source', 'expired'].includes(route.status)
        ) {
            try {
                const status = await this.registry.status(
                    route.provider,
                    route.providerTrackingId,
                    signal,
                )
                route = await this.repository.updateProviderStatus(routeId, {
                    status: mapProviderStatus(status.status, route.status),
                    providerStatus: status.status,
                    sourceTransactionHash:
                        status.sourceTransactionHash ?? route.sourceTransactionHash,
                    destinationTransactionHash:
                        status.destinationTransactionHash ?? route.destinationTransactionHash,
                    failureCode: status.status === 'failed'
                        ? providerErrorCode(route.provider, 'EXECUTION_FAILED')
                        : route.failureCode,
                })
            } catch {
                return {
                    ...routeResponse(route),
                    providerErrorCode: providerErrorCode(route.provider, 'STATUS_UNAVAILABLE'),
                }
            }
        }
        return routeResponse(route)
    }

    async claim(routeId: string, ownerValue: unknown, sourceChainId?: number) {
        routeId = requireRouteId(routeId)
        const ownerAddress = requireOwner(ownerValue)
        if (sourceChainId !== undefined) {
            await this.requireAuthenticationScope(routeId, ownerAddress, sourceChainId)
        }
        return routeResponse(await this.repository.claimSubmission(
            routeId,
            ownerAddress,
        ))
    }

    async submitted(
        routeId: string,
        ownerValue: unknown,
        transactionHashValue: unknown,
        sourceChainId?: number,
    ) {
        routeId = requireRouteId(routeId)
        const ownerAddress = requireOwner(ownerValue)
        if (sourceChainId !== undefined) {
            await this.requireAuthenticationScope(routeId, ownerAddress, sourceChainId)
        }
        const transactionHash =
            typeof transactionHashValue === 'string'
                ? transactionHashValue.toLowerCase()
                : ''
        if (!/^0x[a-f0-9]{64}$/.test(transactionHash)) {
            throw routeError('INVALID_SOURCE_TRANSACTION_HASH', 'Invalid source transaction hash.')
        }
        return routeResponse(await this.repository.markSubmitted(
            routeId,
            ownerAddress,
            transactionHash,
        ))
    }

    private async requireAuthenticationScope(
        routeId: string,
        walletAddress: string,
        sourceChainId: number,
    ) {
        const route = await this.repository.get(routeId)
        if (!route) throw routeError('ROUTE_NOT_FOUND', 'Route was not found.')
        if (route.ownerAddress !== walletAddress) {
            throw routeError('ROUTE_OWNER_MISMATCH', 'Route belongs to another owner.')
        }
        if (route.sourceAsset.chainId !== sourceChainId) {
            throw routeError(
                'AUTH_SOURCE_CHAIN_MISMATCH',
                'Wallet authentication must match the route source chain.',
            )
        }
    }
}

function publicCapabilities(
    capabilities: Awaited<ReturnType<CrossChainRegistry['getCapabilities']>>,
) {
    const source = new Set<number>()
    const destination = new Set<number>()
    const sameChain = new Set<number>()
    for (const route of capabilities.routes) {
        source.add(route.sourceChainId)
        destination.add(route.destinationChainId)
        if (route.sourceChainId === route.destinationChainId) {
            sameChain.add(route.sourceChainId)
        }
    }
    const executionModels = capabilities.provider === 'chainflip'
        ? ['deposit-channel', 'vault-swap'] as const
        : ['evm-transaction'] as const
    const checkedAt = Date.parse(capabilities.fetchedAt)
    return {
        providerId: capabilities.provider,
        available: capabilities.available,
        stale: false,
        reason: capabilities.reason ?? null,
        supportedSourceChainIds: [...source].sort((a, b) => a - b),
        supportedDestinationChainIds: [...destination].sort((a, b) => a - b),
        sameChainSwapChainIds: [...sameChain].sort((a, b) => a - b),
        executionModels,
        supportsExactInput: true,
        supportsExactOutput: false,
        supportsNativeInput: true,
        supportsNativeOutput: true,
        supportsErc20Input: true,
        supportsErc20Output: true,
        supportsRecipient: true,
        supportsStatusTracking: true,
        supportsAffiliateFee: capabilities.provider !== 'chainflip',
        lastCheckedAt: capabilities.fetchedAt,
        expiresAt: new Date(
            (Number.isFinite(checkedAt) ? checkedAt : Date.now()) +
            30 * 60 * 1000,
        ).toISOString(),
    }
}

function requireOwner(value: unknown) {
    const owner = normalizeAddress(value)
    if (!owner) throw routeError('INVALID_ROUTE_OWNER', 'A valid owner address is required.')
    return owner
}

function requireRouteId(value: unknown) {
    const routeId = typeof value === 'string' ? value.toLowerCase() : ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(routeId)) {
        throw routeError('INVALID_ROUTE_ID', 'A valid route ID is required.')
    }
    return routeId
}

function mapProviderStatus(
    status: CrossChainStatus,
    current: PublicRouteState,
): PublicRouteState {
    if (status === 'completed') return 'completed'
    if (status === 'failed') return 'failed'
    if (status === 'refunded') return 'refunded'
    if (status === 'destination-confirming') return 'destination-confirming'
    if (status === 'source-confirming') return 'source-confirmed'
    if (status === 'in-flight') return 'in-flight'
    return current
}

function providerErrorCode(provider: CrossChainProviderName, suffix: string) {
    return `${provider.replaceAll('-', '_').toUpperCase()}_${suffix}`
}

export function routeResponse(route: PublicCrossChainRoute) {
    const {
        ownerAddress: _ownerAddress,
        quoteId: _quoteId,
        ...publicRoute
    } = route
    return {
        ...publicRoute,
        state: publicState(route),
        sourceChainId: route.sourceAsset.chainId,
        destinationChainId: route.destinationAsset.chainId,
        inputAmount: route.inputAmount,
        outputAmount: route.outputAmount,
        estimatedDurationSeconds: route.durationSeconds,
    }
}

function publicState(route: PublicCrossChainRoute) {
    switch (route.status) {
        case 'quoted':
            return 'quote-ready'
        case 'expired':
            return 'quote-expired'
        case 'prepared':
            return route.executionModel === 'deposit-channel'
                ? 'deposit-address-ready'
                : 'source-signature-required'
        case 'awaiting-source':
            return route.executionModel === 'deposit-channel'
                ? 'deposit-pending'
                : 'source-signature-required'
        case 'source-submitted':
            return route.executionModel === 'deposit-channel'
                ? 'deposit-pending'
                : 'source-transaction-pending'
        case 'source-confirmed':
            return 'source-confirmed'
        case 'in-flight':
            return 'cross-chain-pending'
        case 'destination-confirming':
            return 'destination-pending'
        case 'completed':
        case 'failed':
            return route.status
        case 'refunded':
            return 'needs-user-action'
    }
}
