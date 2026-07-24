import type { FastifyPluginAsync } from 'fastify'

import { getApiConfig } from '../config.js'
import {
    NATIVE_TOKEN_ADDRESS,
    createTokenId,
    normalizeAddress,
} from '../lib/address.js'
import { getSafeError } from '../lib/errors.js'
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
import {
    getFallbackTokensForChain,
    type PublicFallbackToken,
} from '../token-discovery/fallback-token-catalog.js'

type WalletTokenQuery = {
    chainId?: string
    address?: string
    includeZero?: string
}

type WalletProviderName = 'unchained' | 'alchemy-portfolio' | 'legacy' | 'fallback'

type WalletProviderDiagnostics = {
    provider: WalletProviderName
    attemptedProviders: WalletProviderName[]
    partial: boolean
    warnings: string[]
}

function zeroFallbackWalletToken(token: PublicFallbackToken): WalletToken {
    const native = token.address === NATIVE_TOKEN_ADDRESS || token.isNative === true
    return {
        classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
        id: createTokenId(token.chainId, token.address),
        chainId: token.chainId,
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        logoURI: token.logoURI,
        logoCandidates: token.logoCandidates,
        logoSource: native ? 'curated' : 'local',
        rawBalance: '0',
        formattedBalance: '0',
        balance: '0',
        priceUSD: null,
        trustedPriceUSD: null,
        marketPriceUSD: null,
        valueUSD: null,
        priceConfidence: 'unknown',
        coinGeckoId: token.coinGeckoId,
        liquidityUsd: 0,
        trustedLiquidityUsd: null,
        largestTrustedPoolLiquidityUsd: null,
        volume24hUsd: null,
        transactionCount24h: null,
        uniqueTraders24h: null,
        trustedPairCount: null,
        oldestTrustedPoolCreatedAt: null,
        establishedAgeDays: null,
        estimatedSellValueUsd: null,
        classificationTier: native ? 'core' : 'established',
        classificationReasons: native
            ? ['native-token', 'fallback-token-catalog']
            : ['fallback-token-catalog'],
        isNative: native,
        recognitionStatus: 'established',
        recognitionReasons: native
            ? ['native-token', 'fallback-token-catalog']
            : ['fallback-token-catalog'],
        verificationStatus: 'established',
        verificationReasons: native
            ? ['native-token', 'fallback-token-catalog']
            : ['fallback-token-catalog'],
        spamStatus: 'clean',
        possibleSpam: false,
        verifiedContract: native ? null : true,
        officialAsset: native,
        issuer: null,
        officialWebsite: null,
        spamReasons: native ? ['native-token'] : ['fallback-token-catalog'],
        securityStatus: 'trusted',
        securityScore: null,
        securityReasons: native ? ['native-token'] : ['fallback-token-catalog'],
        securityProviders: {
            honeypot: { available: false, checkedAt: null, risk: null, riskLevel: null, isHoneypot: null },
            goPlus: { available: false, checkedAt: null, isHoneypot: null },
        },
        visibility: 'primary',
        visibilityReasons: native
            ? ['native-token', 'fallback-token-catalog']
            : ['fallback-token-catalog'],
        includeInPortfolioValue: false,
    }
}

async function fallbackCatalogWalletTokens({
    chainIds,
    address,
}: {
    chainIds: readonly number[]
    address: string
}) {
    const tokens = (await Promise.all(
        chainIds.map(async (chainId) =>
            (await getFallbackTokensForChain(chainId)).map(zeroFallbackWalletToken)),
    )).flat()
    return {
        classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
        address,
        source: 'fallback' as const,
        tokens,
        queriedChainIds: [...chainIds],
        successfulChainIds: [...chainIds].sort((left, right) => left - right),
        failedChainIds: [],
        providerRejectedChainIds: [],
        chainErrors: {},
        batchErrors: [],
        partial: false,
        stale: false,
        diagnostics: {
            pageCount: 0,
            cacheStatus: 'miss' as const,
            failureCode: null,
        },
    }
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

function sortedUnique(values: readonly number[]) {
    return [...new Set(values)].sort((left, right) => left - right)
}

function mergeWalletTokenResults(
    address: string,
    first: WalletTokenResult | null,
    second: WalletTokenResult,
): WalletTokenResult {
    if (!first) return second
    const tokens = new Map<string, WalletToken>()
    for (const token of [...first.tokens, ...second.tokens]) {
        tokens.set(createTokenId(token.chainId, token.address), token)
    }
    const successful = sortedUnique([
        ...first.successfulChainIds,
        ...second.successfulChainIds,
    ])
    const failed = sortedUnique([
        ...first.failedChainIds,
        ...second.failedChainIds,
    ].filter((chainId) => !successful.includes(chainId)))
    return {
        classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
        address,
        source: first.source,
        tokens: [...tokens.values()],
        queriedChainIds: sortedUnique([
            ...first.queriedChainIds,
            ...second.queriedChainIds,
        ]),
        successfulChainIds: successful,
        failedChainIds: failed,
        providerRejectedChainIds: sortedUnique([
            ...(first.providerRejectedChainIds ?? []),
            ...(second.providerRejectedChainIds ?? []),
        ]),
        chainErrors: {
            ...first.chainErrors,
            ...second.chainErrors,
        },
        batchErrors: [],
        partial: first.partial || second.partial || failed.length > 0,
        stale: first.stale || second.stale,
        diagnostics: {
            pageCount:
                (first.diagnostics?.pageCount ?? 0) +
                (second.diagnostics?.pageCount ?? 0),
            cacheStatus:
                first.diagnostics?.cacheStatus === 'hit' ||
                second.diagnostics?.cacheStatus === 'hit'
                    ? 'hit'
                    : 'miss',
            failureCode:
                first.diagnostics?.failureCode ??
                second.diagnostics?.failureCode ??
                null,
        },
    }
}

async function legacyAllChainWalletTokens({
    chainIds,
    address,
    includeZero,
    signal,
}: {
    chainIds: readonly number[]
    address: string
    includeZero: boolean
    signal: AbortSignal
}) {
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
                    tokens.push(...await getWalletTokens({
                        chainId,
                        walletAddress: address,
                        includeZero,
                        signal,
                    }))
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
        source: 'legacy' as const,
        tokens,
        queriedChainIds: [...chainIds],
        successfulChainIds: successfulChainIds.sort((left, right) => left - right),
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
            cacheStatus: 'miss' as const,
            failureCode: null,
        },
    }
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
                .filter((key) => !['chainId', 'address', 'includeZero'].includes(key))
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

            const includeZero = request.query.includeZero === 'true'
            const requestedChainIds = allChains
                ? ACTIVE_TOKEN_DISCOVERY_CHAINS.map((chain) => chain.chainId)
                : [chainId!]
            const alchemySupportedChainIds = requestedChainIds.filter(
                (requestedChainId) =>
                    getAlchemyPortfolioNetwork(requestedChainId) !== null,
            )
            const alchemyUnsupportedChainIds = requestedChainIds.filter(
                (requestedChainId) =>
                    getAlchemyPortfolioNetwork(requestedChainId) === null,
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

            try {
                let result: WalletTokenResult | null = null
                let responseUnsupportedChainIds = alchemyUnsupportedChainIds
                const attemptedProviders: WalletProviderName[] = []
                const warnings: string[] = []

                if (unchainedChainIds.length > 0) {
                    attemptedProviders.push('unchained')
                    try {
                        result = await getUnchainedWalletTokens({
                            walletAddress: address,
                            chainIds: unchainedChainIds,
                            includeZero,
                            signal: controller.signal,
                        })
                        responseUnsupportedChainIds = requestedChainIds.filter(
                            (value) => !configuredUnchained.has(value),
                        )
                    } catch (error) {
                        warnings.push('Unchained wallet balances were unavailable; provider fallback was used.')
                        request.log.warn({
                            provider: 'unchained',
                            requestedChainIds: unchainedChainIds,
                            err: error,
                        }, 'Unchained wallet provider failed; using fallback')
                    }
                }

                if (
                    config.alchemy.portfolio.enabled &&
                    alchemySupportedChainIds.length > 0) {
                    const remainingForAlchemy = result
                        ? requestedChainIds.filter((value) =>
                              !result!.successfulChainIds.includes(value) &&
                              getAlchemyPortfolioNetwork(value) !== null)
                        : alchemySupportedChainIds
                    if (remainingForAlchemy.length > 0) {
                        attemptedProviders.push('alchemy-portfolio')
                        try {
                            const alchemy = await getAlchemyPortfolioWalletTokens({
                                walletAddress: address,
                                chainIds: remainingForAlchemy,
                                includeZero,
                                signal: controller.signal,
                            })
                            result = mergeWalletTokenResults(address, result, alchemy)
                            responseUnsupportedChainIds = requestedChainIds.filter(
                                (value) => !result!.queriedChainIds.includes(value),
                            )
                        } catch {
                            warnings.push('Alchemy portfolio balances were unavailable; legacy fallback was used.')
                        }
                    }
                }

                if (allChains) {
                    const remainingForLegacy = result
                        ? requestedChainIds.filter((value) =>
                              !result!.successfulChainIds.includes(value))
                        : requestedChainIds
                    if (remainingForLegacy.length > 0) {
                        attemptedProviders.push('legacy')
                        try {
                            const legacy = await legacyAllChainWalletTokens({
                                chainIds: remainingForLegacy,
                                address,
                                includeZero,
                                signal: controller.signal,
                            })
                            result = mergeWalletTokenResults(address, result, legacy)
                            responseUnsupportedChainIds = []
                        } catch {
                            warnings.push('Legacy wallet providers were unavailable; fallback catalog was used.')
                        }
                    }
                } else if (!result) {
                    attemptedProviders.push('legacy')
                    try {
                        const tokens = await getWalletTokens({
                            chainId: chainId!,
                            walletAddress: address,
                            includeZero,
                            signal: controller.signal,
                        })
                        result = {
                            classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
                            address,
                            source: 'legacy' as const,
                            tokens,
                            queriedChainIds: [chainId!],
                            successfulChainIds: [chainId!],
                            failedChainIds: [],
                            providerRejectedChainIds: [],
                            chainErrors: {},
                            batchErrors: [],
                            partial: false,
                            stale: false,
                            diagnostics: {
                                pageCount: 0,
                                cacheStatus: 'miss' as const,
                                failureCode: null,
                            },
                        }
                        responseUnsupportedChainIds = []
                    } catch {
                        warnings.push('Legacy wallet provider was unavailable; fallback catalog was used.')
                    }
                }

                const remainingForFallback = result
                    ? requestedChainIds.filter((value) =>
                          !result!.successfulChainIds.includes(value))
                    : requestedChainIds
                if (remainingForFallback.length > 0) {
                    attemptedProviders.push('fallback')
                    const fallback = await fallbackCatalogWalletTokens({
                        chainIds: remainingForFallback,
                        address,
                    })
                    result = mergeWalletTokenResults(address, result, fallback)
                    responseUnsupportedChainIds = []
                }
                if (!result) {
                    throw new Error('Wallet-token fallback catalog did not return a result.')
                }

                const providerDiagnostics: WalletProviderDiagnostics = {
                    provider: result.source,
                    attemptedProviders: [...new Set(attemptedProviders)],
                    partial: result.partial || responseUnsupportedChainIds.length > 0,
                    warnings,
                }
                const response = {
                    classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
                    ...(allChains ? {} : { chainId }),
                    address,
                    // Existing clients validate this legacy source enum. The real
                    // provider remains explicit in the provider field below.
                    source: result.source === 'alchemy-portfolio'
                        ? 'alchemy-portfolio'
                        : 'legacy',
                    provider: result.source,
                    diagnostics: providerDiagnostics,
                    tokens: result.tokens,
                    queriedChainIds: result.queriedChainIds,
                    successfulChainIds: result.successfulChainIds,
                    failedChainIds: result.failedChainIds,
                    providerRejectedChainIds:
                        result.providerRejectedChainIds ?? [],
                    unsupportedChainIds: responseUnsupportedChainIds,
                    chainErrors: result.chainErrors,
                    batchErrors: result.batchErrors,
                    partial: result.partial || responseUnsupportedChainIds.length > 0,
                    stale: result.stale,
                }
                if (process.env.NODE_ENV !== 'production') {
                    request.log.debug({
                        provider: result.source,
                        addressSuffix: address.slice(-4),
                        requestedChainIds,
                        alchemySupportedChainIds,
                        unchainedChainIds,
                        unsupportedChainIds: responseUnsupportedChainIds,
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
