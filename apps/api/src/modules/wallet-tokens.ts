import type { FastifyPluginAsync } from 'fastify'

import { getApiConfig } from '../config.js'
import { normalizeAddress } from '../lib/address.js'
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

type WalletTokenQuery = {
    chainId?: string
    address?: string
    includeZero?: string
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
                let result: Awaited<ReturnType<typeof legacyAllChainWalletTokens>> |
                    Awaited<ReturnType<typeof getAlchemyPortfolioWalletTokens>> |
                    Awaited<ReturnType<typeof getUnchainedWalletTokens>> |
                    null = null
                let responseUnsupportedChainIds = alchemyUnsupportedChainIds

                if (unchainedChainIds.length > 0) {
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
                        request.log.warn({
                            provider: 'unchained',
                            requestedChainIds: unchainedChainIds,
                            err: error,
                        }, 'Unchained wallet provider failed; using fallback')
                    }
                }

                if (!result &&
                    config.alchemy.portfolio.enabled &&
                    alchemySupportedChainIds.length > 0) {
                    result = await getAlchemyPortfolioWalletTokens({
                        walletAddress: address,
                        chainIds: alchemySupportedChainIds,
                        includeZero,
                        signal: controller.signal,
                    })
                    responseUnsupportedChainIds = alchemyUnsupportedChainIds
                } else if (!result && allChains) {
                    result = await legacyAllChainWalletTokens({
                        chainIds: requestedChainIds,
                        address,
                        includeZero,
                        signal: controller.signal,
                    })
                    responseUnsupportedChainIds = []
                } else if (!result) {
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
                }

                const response = {
                    classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
                    ...(allChains ? {} : { chainId }),
                    address,
                    // Existing clients validate this legacy source enum. The real
                    // provider remains explicit in the provider field below.
                    source: result.source === 'unchained' ? 'legacy' : result.source,
                    provider: result.source,
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
