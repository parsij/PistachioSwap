import type { FastifyPluginAsync } from 'fastify'

import { getApiConfig } from '../config.js'
import {
    createTokenId,
    normalizeAddress,
} from '../lib/address.js'
import { getSafeError, ProviderError } from '../lib/errors.js'
import {
    getAlchemyPortfolioWalletTokens,
    hasStaleAlchemyPortfolioWalletCache,
} from '../providers/alchemy/portfolio-wallet-tokens.js'
import {
    getAlchemyPortfolioNetwork,
} from '../providers/alchemy/portfolio-networks.js'
import {
    getWalletTokens,
    WALLET_TOKEN_CLASSIFICATION_VERSION,
    type WalletToken,
} from '../providers/alchemy/wallet-tokens.js'
import {
    getConfiguredUnchainedChainIds,
    getUnchainedWalletTokens,
    isUnchainedWalletEnabled,
} from '../providers/unchained/wallet-tokens.js'
import {
    ACTIVE_TOKEN_DISCOVERY_CHAINS,
    getTokenDiscoveryChain,
} from '../token-discovery/registry.js'

type WalletTokenQuery = {
    chainId?: string
    address?: string
    includeZero?: string
    refresh?: string
}

type WalletProviderName = 'unchained' | 'alchemy-portfolio' | 'legacy'

type WalletProviderDiagnostics = {
    provider: WalletProviderName
    attemptedProviders: WalletProviderName[]
    partial: boolean
    warnings: string[]
}

type WalletTokenResult = {
    classificationVersion: typeof WALLET_TOKEN_CLASSIFICATION_VERSION
    address: string
    source: WalletProviderName
    tokens: WalletToken[]
    queriedChainIds: number[]
    successfulChainIds: number[]
    failedChainIds: number[]
    providerRejectedChainIds: number[]
    chainErrors: Record<string, string>
    batchErrors: unknown[]
    partial: boolean
    stale: boolean
    diagnostics: {
        pageCount: number
        cacheStatus: 'hit' | 'miss' | 'stale'
        failureCode: string | null
    }
}

const ALL_CHAIN_WALLET_TOKEN_DEADLINE_MS = 11_000
const WALLET_TOKEN_PROVIDER_DEADLINE_BUFFER_MS = 250
const WALLET_TOKEN_TIMEOUT_MESSAGE =
    'This network balance could not be refreshed before the wallet request deadline.'

function allChainWalletTokenDeadlineMs() {
    const value = Number(process.env.WALLET_TOKEN_ALL_CHAIN_DEADLINE_MS)
    return Number.isFinite(value) && value >= 500 && value <= 12_000
        ? value
        : ALL_CHAIN_WALLET_TOKEN_DEADLINE_MS
}

function sortedUnique(values: readonly number[]) {
    return [...new Set(values)].sort((left, right) => left - right)
}

function timeoutError() {
    return new ProviderError({
        code: 'WALLET_TOKEN_REQUEST_DEADLINE_EXCEEDED',
        message: 'Wallet balances could not be loaded before the request deadline.',
        statusCode: 503,
        retryable: true,
        outcome: 'timeout',
    })
}

function remainingMs(deadlineAt: number) {
    return Math.max(0, deadlineAt - Date.now())
}

async function withDeadline<T>({
    operation,
    deadlineAt,
    controller,
}: {
    operation: Promise<T>
    deadlineAt: number
    controller: AbortController
}): Promise<T> {
    const timeoutMs = Math.max(
        0,
        remainingMs(deadlineAt) - WALLET_TOKEN_PROVIDER_DEADLINE_BUFFER_MS,
    )
    if (timeoutMs <= 0) {
        controller.abort(timeoutError())
        throw timeoutError()
    }
    let timeout: ReturnType<typeof setTimeout> | null = null
    operation.catch(() => undefined)
    try {
        return await Promise.race([
            operation,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => {
                    const error = timeoutError()
                    controller.abort(error)
                    reject(error)
                }, timeoutMs)
            }),
        ])
    } finally {
        if (timeout !== null) clearTimeout(timeout)
    }
}

function rawBalance(token: WalletToken) {
    const value = String(token.rawBalance ?? '').trim()
    return /^\d+$/.test(value) ? BigInt(value) : 0n
}

function mergeLogoCandidates(first: WalletToken, second: WalletToken) {
    return [
        ...(second.logoCandidates ?? []),
        second.logoURI,
        ...(first.logoCandidates ?? []),
        first.logoURI,
    ].filter((value, index, values): value is string =>
        typeof value === 'string' && value.length > 0 && values.indexOf(value) === index)
}

function mergeWalletTokenRecord(first: WalletToken, second: WalletToken) {
    const firstBalance = rawBalance(first)
    const secondBalance = rawBalance(second)
    const preferred = secondBalance >= firstBalance ? second : first
    const supplement = preferred === second ? first : second
    const logos = mergeLogoCandidates(first, second)
    return {
        ...supplement,
        ...preferred,
        rawBalance: (secondBalance >= firstBalance
            ? second.rawBalance ?? first.rawBalance
            : first.rawBalance ?? second.rawBalance),
        formattedBalance: preferred.formattedBalance ?? supplement.formattedBalance,
        balance: preferred.balance ?? supplement.balance,
        valueUSD: preferred.valueUSD ?? supplement.valueUSD ?? null,
        trustedPriceUSD:
            preferred.trustedPriceUSD ?? supplement.trustedPriceUSD ?? null,
        marketPriceUSD:
            preferred.marketPriceUSD ?? supplement.marketPriceUSD ?? null,
        priceUSD: preferred.priceUSD ?? supplement.priceUSD ?? null,
        logoURI: logos[0] ?? null,
        logoCandidates: logos,
    } satisfies WalletToken
}

function sanitizeDiagnostics({
    queried,
    successful,
    failed,
    providerRejected,
    chainErrors,
}: {
    queried: readonly number[]
    successful: readonly number[]
    failed: readonly number[]
    providerRejected: readonly number[]
    chainErrors: Record<string, string>
}) {
    const queriedSet = new Set(sortedUnique(queried))
    const successfulSet = new Set(
        sortedUnique(successful).filter((chainId) => queriedSet.has(chainId)),
    )
    const failedIds = sortedUnique(failed).filter((chainId) =>
        queriedSet.has(chainId) && !successfulSet.has(chainId))
    const failedSet = new Set(failedIds)
    const rejectedIds = sortedUnique(providerRejected).filter((chainId) =>
        queriedSet.has(chainId) &&
        !successfulSet.has(chainId) &&
        !failedSet.has(chainId))
    const unresolved = new Set([...failedIds, ...rejectedIds])
    const cleanErrors = Object.fromEntries(
        Object.entries(chainErrors).filter(([chainId]) =>
            unresolved.has(Number(chainId))),
    )
    for (const chainId of unresolved) {
        cleanErrors[String(chainId)] ??=
            'This network balance could not be refreshed.'
    }
    return {
        queriedChainIds: [...queriedSet].sort((left, right) => left - right),
        successfulChainIds: [...successfulSet].sort((left, right) => left - right),
        failedChainIds: failedIds,
        providerRejectedChainIds: rejectedIds,
        chainErrors: cleanErrors,
    }
}

function mergeWalletTokenResults(
    address: string,
    first: WalletTokenResult | null,
    second: WalletTokenResult,
): WalletTokenResult {
    if (!first) {
        const diagnostics = sanitizeDiagnostics({
            queried: second.queriedChainIds,
            successful: second.successfulChainIds,
            failed: second.failedChainIds,
            providerRejected: second.providerRejectedChainIds ?? [],
            chainErrors: second.chainErrors,
        })
        return {
            ...second,
            ...diagnostics,
            partial: second.partial ||
                diagnostics.failedChainIds.length > 0 ||
                diagnostics.providerRejectedChainIds.length > 0,
        }
    }

    const tokens = new Map<string, WalletToken>()
    for (const token of [...first.tokens, ...second.tokens]) {
        const key = createTokenId(token.chainId, token.address)
        const existing = tokens.get(key)
        tokens.set(key, existing ? mergeWalletTokenRecord(existing, token) : token)
    }
    const diagnostics = sanitizeDiagnostics({
        queried: [...first.queriedChainIds, ...second.queriedChainIds],
        successful: [...first.successfulChainIds, ...second.successfulChainIds],
        failed: [...first.failedChainIds, ...second.failedChainIds],
        providerRejected: [
            ...(first.providerRejectedChainIds ?? []),
            ...(second.providerRejectedChainIds ?? []),
        ],
        chainErrors: {
            ...first.chainErrors,
            ...second.chainErrors,
        },
    })
    return {
        classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
        address,
        source: second.successfulChainIds.length > 0 ? second.source : first.source,
        tokens: [...tokens.values()],
        ...diagnostics,
        batchErrors: [...(first.batchErrors ?? []), ...(second.batchErrors ?? [])],
        partial: first.partial || second.partial ||
            diagnostics.failedChainIds.length > 0 ||
            diagnostics.providerRejectedChainIds.length > 0,
        stale: first.stale || second.stale,
        diagnostics: {
            pageCount:
                (first.diagnostics?.pageCount ?? 0) +
                (second.diagnostics?.pageCount ?? 0),
            cacheStatus:
                first.diagnostics?.cacheStatus === 'hit' ||
                second.diagnostics?.cacheStatus === 'hit'
                    ? 'hit'
                    : first.diagnostics?.cacheStatus === 'stale' ||
                        second.diagnostics?.cacheStatus === 'stale'
                      ? 'stale'
                      : 'miss',
            failureCode:
                second.diagnostics?.failureCode ??
                first.diagnostics?.failureCode ??
                null,
        },
    }
}

async function legacyWalletTokens({
    chainIds,
    address,
    includeZero,
    refresh,
    signal,
}: {
    chainIds: readonly number[]
    address: string
    includeZero: boolean
    refresh: boolean
    signal: AbortSignal
}): Promise<WalletTokenResult> {
    const tokens: WalletToken[] = []
    const successfulChainIds: number[] = []
    const chainErrors: Record<string, string> = {}
    let cursor = 0
    const workers = Array.from(
        { length: Math.min(4, chainIds.length) },
        async () => {
            while (cursor < chainIds.length) {
                const index = cursor
                cursor += 1
                const chainId = chainIds[index]
                try {
                    const chainTokens = await getWalletTokens({
                        chainId,
                        walletAddress: address,
                        includeZero,
                        refresh,
                        signal,
                    })
                    tokens.push(...chainTokens)
                    successfulChainIds.push(chainId)
                } catch {
                    chainErrors[String(chainId)] =
                        'This network balance could not be refreshed.'
                }
            }
        },
    )
    await Promise.all(workers)
    if (successfulChainIds.length === 0 && chainIds.length > 0) {
        throw new Error('Legacy wallet-token providers are unavailable.')
    }
    return {
        classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
        address,
        source: 'legacy',
        tokens,
        queriedChainIds: [...chainIds],
        successfulChainIds: sortedUnique(successfulChainIds),
        failedChainIds: Object.keys(chainErrors).map(Number).sort(
            (left, right) => left - right,
        ),
        providerRejectedChainIds: [],
        chainErrors,
        batchErrors: [],
        partial: Object.keys(chainErrors).length > 0,
        stale: false,
        diagnostics: {
            pageCount: 0,
            cacheStatus: 'miss',
            failureCode: null,
        },
    }
}

function chainsWithTokens(result: WalletTokenResult | null) {
    return new Set((result?.tokens ?? []).map((token) => Number(token.chainId)))
}

function mergeTimeoutFailures(
    result: WalletTokenResult,
    requestedChainIds: readonly number[],
) {
    const unresolvedChainIds = requestedChainIds.filter((value) =>
        !result.successfulChainIds.includes(value))
    const chainErrors = { ...result.chainErrors }
    for (const chainId of unresolvedChainIds) {
        chainErrors[String(chainId)] ??= WALLET_TOKEN_TIMEOUT_MESSAGE
    }
    return sanitizeDiagnostics({
        queried: requestedChainIds,
        successful: result.successfulChainIds,
        failed: [...result.failedChainIds, ...unresolvedChainIds],
        providerRejected: result.providerRejectedChainIds,
        chainErrors,
    })
}

export const walletTokenRoutes: FastifyPluginAsync = async (app) => {
    app.get<{ Querystring: WalletTokenQuery }>(
        '/v1/wallet-tokens',
        {
            schema: {
                querystring: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                        chainId: {
                            type: 'string',
                            pattern: '^(?:all|[1-9][0-9]*)$',
                        },
                        address: {
                            type: 'string',
                            pattern: '^0x[0-9a-fA-F]{40}$',
                        },
                        refresh: {
                            type: 'string',
                            enum: ['true', 'false'],
                        },
                        includeZero: {
                            type: 'string',
                            enum: ['true', 'false'],
                        },
                    },
                },
            },
            config: {
                rateLimit: { max: 20, timeWindow: '1 minute' },
            },
        },
        async (request, reply) => {
            const startedAt = Date.now()
            const config = getApiConfig()
            const unsupportedParameters = Object.keys(request.query)
                .filter((key) => !['chainId', 'address', 'includeZero', 'refresh'].includes(key))
            if (unsupportedParameters.length > 0) {
                return reply.code(400).send({
                    error: {
                        code: 'UNSUPPORTED_QUERY_PARAMETER',
                        message: 'Unsupported query parameter.',
                    },
                })
            }

            const rawChainId = request.query.chainId ?? String(config.chainId)
            const allChains = rawChainId.toLowerCase() === 'all'
            const chainId = allChains ? null : Number(rawChainId)
            const address = normalizeAddress(request.query.address)
            if (
                !allChains &&
                (!Number.isSafeInteger(chainId) ||
                    !getTokenDiscoveryChain(chainId!)?.active)
            ) {
                return reply.code(400).send({
                    error: {
                        code: 'UNSUPPORTED_CHAIN',
                        message: 'The requested chain is not enabled for token discovery.',
                    },
                })
            }
            if (!address) {
                return reply.code(400).send({
                    error: {
                        code: 'INVALID_WALLET_ADDRESS',
                        message: 'A valid wallet address is required.',
                    },
                })
            }
            if (
                request.query.includeZero !== undefined &&
                !['true', 'false'].includes(request.query.includeZero)
            ) {
                return reply.code(400).send({
                    error: {
                        code: 'INVALID_INCLUDE_ZERO',
                        message: 'includeZero must be true or false.',
                    },
                })
            }

            if (request.query.refresh !== undefined &&
                !['true', 'false'].includes(request.query.refresh)) {
                return reply.code(400).send({ error: {
                    code: 'INVALID_REFRESH',
                    message: 'refresh must be true or false.',
                } })
            }
            const refresh = request.query.refresh === 'true'
            const includeZero = request.query.includeZero === 'true'
            const requestedChainIds = allChains
                ? ACTIVE_TOKEN_DISCOVERY_CHAINS.map((chain) => chain.chainId)
                : [chainId!]
            const alchemySupportedChainIds = requestedChainIds.filter(
                (requestedChainId) =>
                    getAlchemyPortfolioNetwork(requestedChainId) !== null,
            )
            const configuredUnchained = new Set(
                isUnchainedWalletEnabled()
                    ? getConfiguredUnchainedChainIds()
                    : [],
            )
            const unchainedChainIds = requestedChainIds.filter((value) =>
                configuredUnchained.has(value))
            const controller = new AbortController()
            const abort = () => controller.abort()
            request.raw.once('aborted', abort)
            const deadlineAt = allChains
                ? startedAt + allChainWalletTokenDeadlineMs()
                : startedAt + Math.min(allChainWalletTokenDeadlineMs(), 25_000)

            try {
                let result: WalletTokenResult | null = null
                const attemptedProviders: WalletProviderName[] = []
                const warnings: string[] = []
                const providerSuccess = new Set<WalletProviderName>()
                let deadlineExceeded = false

                if (unchainedChainIds.length > 0) {
                    attemptedProviders.push('unchained')
                    try {
                        const unchained = await withDeadline({
                            deadlineAt,
                            controller,
                            operation: getUnchainedWalletTokens({
                                walletAddress: address,
                                chainIds: unchainedChainIds,
                                includeZero,
                                refresh,
                                signal: controller.signal,
                            }),
                        })
                        result = mergeWalletTokenResults(address, result, unchained)
                        providerSuccess.add('unchained')
                    } catch (error) {
                        deadlineExceeded = getSafeError(error).body.error.code ===
                            'WALLET_TOKEN_REQUEST_DEADLINE_EXCEEDED'
                        warnings.push(
                            'Unchained wallet balances were unavailable; provider fallback was used.',
                        )
                        request.log.warn({
                            provider: 'unchained',
                            requestedChainIds: unchainedChainIds,
                            err: error,
                        }, 'Unchained wallet provider failed; using fallback')
                    }
                }

                // Alchemy is deliberately queried even when Unchained returned 200.
                // A newly configured/self-hosted indexer can be healthy but incomplete,
                // and must not erase balances from the proven provider path.
                if (
                    !deadlineExceeded &&
                    config.alchemy.portfolio.enabled &&
                    alchemySupportedChainIds.length > 0
                ) {
                    attemptedProviders.push('alchemy-portfolio')
                    try {
                        const alchemy = await withDeadline({
                            deadlineAt,
                            controller,
                            operation: getAlchemyPortfolioWalletTokens({
                                walletAddress: address,
                                chainIds: alchemySupportedChainIds,
                                includeZero,
                                refresh,
                                signal: controller.signal,
                            }),
                        })
                        result = mergeWalletTokenResults(address, result, alchemy)
                        providerSuccess.add('alchemy-portfolio')
                    } catch (error) {
                        deadlineExceeded = getSafeError(error).body.error.code ===
                            'WALLET_TOKEN_REQUEST_DEADLINE_EXCEEDED'
                        warnings.push(
                            'Alchemy portfolio balances were unavailable; legacy fallback was used.',
                        )
                    }
                }

                const tokenChains = chainsWithTokens(result)
                const confirmedByAlchemy = new Set(
                    result?.source === 'alchemy-portfolio'
                        ? result.successfulChainIds
                        : [],
                )
                const remainingForLegacy = requestedChainIds.filter((value) => {
                    if (confirmedByAlchemy.has(value)) return false
                    const unchainedCovered = result?.successfulChainIds.includes(value) &&
                        configuredUnchained.has(value)
                    // An empty Unchained response is not authoritative. Verify it
                    // through the legacy provider before accepting an empty wallet.
                    return !unchainedCovered || !tokenChains.has(value)
                })

                if (!deadlineExceeded && remainingForLegacy.length > 0) {
                    attemptedProviders.push('legacy')
                    try {
                        const legacy = await withDeadline({
                            deadlineAt,
                            controller,
                            operation: legacyWalletTokens({
                                chainIds: remainingForLegacy,
                                address,
                                includeZero,
                                refresh,
                                signal: controller.signal,
                            }),
                        })
                        result = mergeWalletTokenResults(address, result, legacy)
                        providerSuccess.add('legacy')
                    } catch (error) {
                        deadlineExceeded = deadlineExceeded ||
                            getSafeError(error).body.error.code ===
                                'WALLET_TOKEN_REQUEST_DEADLINE_EXCEEDED'
                        warnings.push(
                            'Legacy wallet providers were unavailable; previously cached balances should be retained.',
                        )
                    }
                }

                if (deadlineExceeded && (!result || result.successfulChainIds.length === 0)) {
                    throw timeoutError()
                }
                if (!result || result.successfulChainIds.length === 0) {
                    throw new Error('Wallet-token providers are unavailable.')
                }

                const actualProvider: WalletProviderName =
                    providerSuccess.has('alchemy-portfolio')
                        ? 'alchemy-portfolio'
                        : providerSuccess.has('legacy')
                          ? 'legacy'
                          : 'unchained'
                const compatibilitySource = actualProvider === 'alchemy-portfolio'
                    ? 'alchemy-portfolio'
                    : 'legacy'
                const unresolvedChainIds = requestedChainIds.filter((value) =>
                    !result!.successfulChainIds.includes(value))
                const finalDiagnostics = deadlineExceeded
                    ? mergeTimeoutFailures(result, requestedChainIds)
                    : sanitizeDiagnostics({
                        queried: requestedChainIds,
                        successful: result.successfulChainIds,
                        failed: [...result.failedChainIds, ...unresolvedChainIds],
                        providerRejected: result.providerRejectedChainIds,
                        chainErrors: result.chainErrors,
                    })
                const providerDiagnostics: WalletProviderDiagnostics = {
                    provider: actualProvider,
                    attemptedProviders: [...new Set(attemptedProviders)],
                    partial: finalDiagnostics.failedChainIds.length > 0 ||
                        finalDiagnostics.providerRejectedChainIds.length > 0,
                    warnings,
                }
                const response = {
                    classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
                    ...(allChains ? {} : { chainId }),
                    address,
                    source: compatibilitySource,
                    provider: actualProvider,
                    diagnostics: providerDiagnostics,
                    tokens: result.tokens,
                    ...finalDiagnostics,
                    unsupportedChainIds: [],
                    batchErrors: result.batchErrors,
                    partial: providerDiagnostics.partial,
                    stale: result.stale,
                }

                if (process.env.NODE_ENV !== 'production') {
                    request.log.debug({
                        provider: actualProvider,
                        addressSuffix: address.slice(-4),
                        requestedChainIds,
                        alchemySupportedChainIds,
                        unchainedChainIds,
                        tokenCount: result.tokens.length,
                        pageCount: result.diagnostics.pageCount,
                        cacheStatus: result.diagnostics.cacheStatus,
                        partial: response.partial,
                        durationMs: Date.now() - startedAt,
                        failureCode: result.diagnostics.failureCode,
                    }, 'Wallet portfolio request completed')
                }
                reply.header('cache-control', 'private, no-store')
                return response
            } catch (error) {
                const safe = getSafeError(error)
                const staleEntryAvailable = hasStaleAlchemyPortfolioWalletCache({
                    walletAddress: address,
                    chainIds: alchemySupportedChainIds,
                    includeZero,
                })
                const log = safe.body.error.code === 'ALCHEMY_PORTFOLIO_REQUEST_ABORTED'
                    ? request.log.debug.bind(request.log)
                    : request.log.warn.bind(request.log)
                log({
                    operation: allChains
                        ? 'wallet-tokens-all-chain'
                        : 'wallet-tokens-single-chain',
                    classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
                    cacheVersion: `v${WALLET_TOKEN_CLASSIFICATION_VERSION}`,
                    provider: unchainedChainIds.length > 0
                        ? 'unchained-with-fallback'
                        : config.alchemy.portfolio.enabled
                          ? 'alchemy-portfolio'
                          : 'legacy',
                    safeCode: safe.body.error.code,
                    staleEntryAvailable,
                }, 'Wallet token request failed')
                return reply.code(safe.statusCode).send(safe.body)
            } finally {
                request.raw.off('aborted', abort)
            }
        },
    )
}
