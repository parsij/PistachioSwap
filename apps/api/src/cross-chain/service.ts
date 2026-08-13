import { normalizeAddress } from '../lib/address.js'
import { CrossChainRegistry } from './registry.js'
import {
    createCrossChainRouteRepository,
    type CrossChainRouteRepository,
    routeError,
} from './repository.js'
import type {
    CrossChainQuote,
    CrossChainProviderName,
    CrossChainRequest,
    CrossChainStatus,
    PublicCrossChainRoute,
    PublicRouteState,
} from './types.js'
import {
    PrivateGasAssistError,
    requestPrivateGasAssist,
} from '../modules/gas-assist-proxy.js'

type PrivateGasAssistRequest = typeof requestPrivateGasAssist

export class CrossChainRouteService {
    constructor(
        private readonly registry = new CrossChainRegistry(),
        private readonly repository: CrossChainRouteRepository =
            createCrossChainRouteRepository(),
        private readonly privateGasAssistRequest: PrivateGasAssistRequest =
            requestPrivateGasAssist,
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
            })),
            diagnostics: {
                eligibleProviders: result.eligibleProviders,
                skippedProviders: result.skippedProviders,
                attemptedProviders: result.attemptedProviders,
                successfulRouteCount: routes.length,
            },
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
                    route.sourceTransactionHash ?? undefined,
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

    async prepareSponsorship({
        routeId,
        ownerValue,
        sourceChainId,
        clientIp,
        idempotencyKey,
        signal,
    }: {
        routeId: string
        ownerValue: unknown
        sourceChainId: number
        clientIp: string
        idempotencyKey: string
        signal?: AbortSignal
    }) {
        routeId = requireRouteId(routeId)
        const ownerAddress = requireOwner(ownerValue)
        if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
            throw routeError(
                'IDEMPOTENCY_KEY_REQUIRED',
                'A valid Idempotency-Key header is required.',
            )
        }
        await this.requireAuthenticationScope(routeId, ownerAddress, sourceChainId)
        const originalRoute = await this.repository.get(routeId)
        if (!originalRoute) throw routeError('ROUTE_NOT_FOUND', 'Route was not found.')
        if (originalRoute.sourceAsset.chainId !== 56 ||
            originalRoute.destinationAsset.chainId === 56 ||
            originalRoute.executionModel !== 'evm-transaction' ||
            originalRoute.sourceAsset.address ===
                '0x0000000000000000000000000000000000000000') {
            throw routeError(
                'CROSS_CHAIN_GAS_ASSIST_UNSUPPORTED',
                'Gas Assist only supports exact BEP-20 source transactions from BNB Chain.',
            )
        }

        const grossInputAmount = originalRoute.inputAmount
        let expectedAmount = grossInputAmount
        let candidateRoute = originalRoute
        let candidateQuote = await this.registry.prepare(
            originalRoute.quoteId,
            signal,
        )

        for (let attempt = 0; attempt < 4; attempt += 1) {
            if (attempt > 0) {
                const quote = await this.registry.requoteProvider(
                    originalRoute.quoteId,
                    expectedAmount,
                    signal,
                )
                candidateRoute = await this.repository.create(quote)
                candidateRoute = await this.repository.markPrepared(
                    candidateRoute.routeId,
                    ownerAddress,
                )
                candidateQuote = await this.registry.prepare(quote.quoteId, signal)
                if (candidateQuote.statusId &&
                    (candidateQuote.statusId !== candidateRoute.providerTrackingId ||
                        candidateQuote.deposit?.expiresAt !== undefined)) {
                    candidateRoute = await this.repository.setPreparedProviderReference(
                        candidateRoute.routeId,
                        candidateQuote.statusId,
                        candidateQuote.deposit?.expiresAt ?? candidateQuote.expiresAt,
                    )
                }
            }
            const exactRoute = exactSponsoredRoute(
                candidateRoute,
                candidateQuote,
                ownerAddress,
            )
            try {
                const order = await this.privateGasAssistRequest({
                    pathname: '/internal/v1/sponsorship/cross-chain/orders',
                    clientIp,
                    idempotencyKey,
                    body: {
                        walletAddress: ownerAddress,
                        grossInputAmount,
                        slippageBps: candidateQuote.request.slippageBps,
                        route: exactRoute,
                    },
                })
                const orderRecord = order && typeof order === 'object'
                    ? order as Record<string, unknown>
                    : {}
                const storedRouteId = String(
                    orderRecord.crossChainRouteId ?? candidateRoute.publicRouteId,
                )
                const storedRoute = storedRouteId === candidateRoute.publicRouteId
                    ? candidateRoute
                    : await this.repository.get(storedRouteId)
                if (!storedRoute || storedRoute.ownerAddress !== ownerAddress) {
                    throw routeError(
                        'CROSS_CHAIN_SPONSORSHIP_ROUTE_MISSING',
                        'The stored sponsored route is unavailable.',
                    )
                }
                const preparedRoute = storedRouteId === candidateRoute.publicRouteId
                    ? {
                        ...routeResponse(candidateRoute),
                        steps: candidateQuote.steps,
                        transaction: candidateQuote.transaction,
                        deposit: candidateQuote.deposit,
                    }
                    : routeResponse(storedRoute)
                return {
                    order,
                    preparedRoute,
                }
            } catch (error) {
                if (!(error instanceof PrivateGasAssistError) ||
                    error.code !== 'ORDER_REQUOTE_REQUIRED') throw error
                const nextAmount = String(
                    error.details?.expectedNetSwapAmountRaw ?? '',
                )
                if (!/^[1-9]\d*$/.test(nextAmount) ||
                    BigInt(nextAmount) >= BigInt(grossInputAmount) ||
                    nextAmount === expectedAmount || attempt === 3) {
                    throw routeError(
                        'CROSS_CHAIN_SPONSORSHIP_UNSTABLE',
                        'The exact sponsored route could not be stabilized.',
                    )
                }
                expectedAmount = nextAmount
            }
        }
        throw routeError(
            'CROSS_CHAIN_SPONSORSHIP_UNSTABLE',
            'The exact sponsored route could not be stabilized.',
        )
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

function exactSponsoredRoute(
    route: PublicCrossChainRoute,
    quote: CrossChainQuote,
    ownerAddress: string,
) {
    const transaction = quote.transaction
    if (!transaction || transaction.chainId !== 56 ||
        transaction.value !== '0' || !transaction.allowanceTarget) {
        throw routeError(
            'CROSS_CHAIN_TRANSACTION_NOT_SPONSORABLE',
            'The prepared source transaction cannot use exact MegaFuel sponsorship.',
        )
    }
    if (quote.request.ownerAddress !== ownerAddress ||
        quote.request.recipient !== route.recipient ||
        quote.request.amount !== route.inputAmount ||
        quote.provider !== route.provider ||
        quote.executionModel !== 'evm-transaction') {
        throw routeError(
            'CROSS_CHAIN_ROUTE_MISMATCH',
            'The prepared sponsored route no longer matches the reviewed route.',
        )
    }
    return {
        publicRouteId: route.publicRouteId,
        provider: route.provider,
        executionModel: route.executionModel,
        ownerAddress,
        sourceAsset: route.sourceAsset,
        destinationAsset: route.destinationAsset,
        recipient: route.recipient,
        inputAmount: route.inputAmount,
        outputAmount: route.outputAmount,
        minimumOutputAmount: route.minimumOutputAmount,
        expiresAt: quote.expiresAt,
        transaction,
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
