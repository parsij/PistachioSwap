import type {
    FastifyPluginAsync,
    FastifyReply,
    FastifyRequest,
} from 'fastify'

import {
    CrossChainAuthError,
    getCrossChainAuthService,
    type CrossChainAuthService,
} from '../cross-chain/auth.js'
import { CrossChainRouteService } from '../cross-chain/service.js'
import { CrossChainQuoteError } from '../cross-chain/registry.js'
import {
    CROSS_CHAIN_PROVIDERS,
    type CrossChainProviderName,
} from '../cross-chain/types.js'
import { validateCrossChainRequest } from '../cross-chain/validation.js'
import { getApiConfig } from '../config.js'
import { isRecord } from '../lib/http.js'

function providerName(value: unknown): CrossChainProviderName {
    if (
        typeof value !== 'string' ||
        !CROSS_CHAIN_PROVIDERS.includes(value as CrossChainProviderName)
    ) throw new Error('Invalid cross-chain provider.')
    return value as CrossChainProviderName
}

function abortSignal(request: FastifyRequest) {
    const controller = new AbortController()
    request.raw.once('aborted', () => controller.abort())
    return controller.signal
}

export function createCrossChainRoutes(
    service = new CrossChainRouteService(),
    auth: CrossChainAuthService = getCrossChainAuthService(),
): FastifyPluginAsync {
    return async (app) => {
        app.post<{ Body: unknown }>(
            '/v1/cross-chain/auth/challenge',
            { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
            async (request, reply) => {
                try {
                    const body = exactBody(request.body, ['walletAddress', 'chainId'])
                    return reply.send(await auth.createChallenge({
                        walletAddress: String(body.walletAddress ?? ''),
                        chainId: Number(body.chainId),
                        domain: requestDomain(request.headers.host, getApiConfig().corsOrigins),
                    }))
                } catch (error) {
                    return sendError(reply, error)
                }
            },
        )
        app.post<{ Body: unknown }>(
            '/v1/cross-chain/auth/verify',
            { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
            async (request, reply) => {
                try {
                    const body = exactBody(request.body, ['challengeId', 'signature'])
                    return reply.send(await auth.verifyChallenge({
                        challengeId: String(body.challengeId ?? ''),
                        signature: String(body.signature ?? ''),
                        domain: requestDomain(request.headers.host, getApiConfig().corsOrigins),
                    }))
                } catch (error) {
                    return sendError(reply, error)
                }
            },
        )

        app.get('/v1/cross-chain/providers', async (request) => ({
            providers: await service.getProviderSummaries(
                abortSignal(request),
            ),
        }))

        app.get<{ Params: { providerId: string } }>(
            '/v1/cross-chain/providers/:providerId/capabilities',
            async (request, reply) => {
                try {
                    return reply.send({
                        capabilities: await service.getCapabilities(
                            providerName(request.params.providerId),
                            abortSignal(request),
                        ),
                    })
                } catch (error) {
                    return sendError(reply, error)
                }
            },
        )

        const quoteHandler = async (
            request: FastifyRequest<{ Body: unknown }>,
            reply: FastifyReply,
        ) => {
            let normalized
            try {
                normalized = validateCrossChainRequest(request.body)
            } catch (error) {
                return sendError(reply, error)
            }
            try {
                const result = await service.quote(normalized, abortSignal(request))
                request.log.info({
                    requestId: request.id,
                    sourceChainId: normalized.sourceAsset.chainId,
                    destinationChainId: normalized.destinationAsset.chainId,
                    sellTokenSuffix: normalized.sourceAsset.address.slice(-6),
                    buyTokenSuffix: normalized.destinationAsset.address.slice(-6),
                    amountDigits: normalized.amount.length,
                    eligibleProviders: result.diagnostics.eligibleProviders,
                    skippedProviders: result.diagnostics.skippedProviders,
                    attemptedProviders: result.diagnostics.attemptedProviders,
                    providerFailures: result.failures,
                    successfulRouteCount: result.routes.length,
                }, 'Cross-chain route request completed')
                return reply.send(result)
            } catch (error) {
                request.log.warn({
                    requestId: request.id,
                    sourceChainId: normalized.sourceAsset.chainId,
                    destinationChainId: normalized.destinationAsset.chainId,
                    sellTokenSuffix: normalized.sourceAsset.address.slice(-6),
                    buyTokenSuffix: normalized.destinationAsset.address.slice(-6),
                    amountDigits: normalized.amount.length,
                    eligibleProviders: error instanceof CrossChainQuoteError
                        ? error.eligibleProviders
                        : [],
                    skippedProviders: error instanceof CrossChainQuoteError
                        ? error.skippedProviders
                        : [],
                    attemptedProviders: error instanceof CrossChainQuoteError
                        ? error.attemptedProviders
                        : [],
                    providerFailures: error instanceof CrossChainQuoteError
                        ? error.failures
                        : [],
                    successfulRouteCount: 0,
                }, 'Cross-chain route request failed')
                return sendError(reply, error, 503, 'CROSS_CHAIN_NO_EXECUTABLE_ROUTE')
            }
        }
        /*
         * The only unauthenticated write path on this service, and the most
         * expensive one: each call fans out to every enabled provider and
         * stores a route per returned quote. The global per-IP bucket alone
         * lets a single client fill the route store.
         */
        const quoteRouteOptions = {
            config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        }
        app.post<{ Body: unknown }>(
            '/v1/cross-chain/quote',
            quoteRouteOptions,
            quoteHandler,
        )
        app.post<{ Body: unknown }>(
            '/v1/cross-chain/routes',
            quoteRouteOptions,
            quoteHandler,
        )

        const prepare = async (
            routeId: unknown,
            body: unknown,
            authorization: string | undefined,
            reply: FastifyReply,
        ) => {
            try {
                const session = await auth.authenticate(authorization)
                exactBody(body, [], [])
                return reply.send(await service.prepare(
                    String(routeId ?? ''),
                    session.walletAddress,
                    session.chainId,
                ))
            } catch (error) {
                return sendError(reply, error)
            }
        }
        app.post<{ Body: unknown }>('/v1/cross-chain/prepare', async (request, reply) => {
            try {
                const body = exactBody(request.body, ['routeId'])
                const session = await auth.authenticate(request.headers.authorization)
                return reply.send(await service.prepare(
                    String(body.routeId ?? ''),
                    session.walletAddress,
                    session.chainId,
                ))
            } catch (error) {
                return sendError(reply, error)
            }
        })
        app.post<{ Params: { routeId: string }; Body: unknown }>(
            '/v1/cross-chain/routes/:routeId/prepare',
            (request, reply) => prepare(
                request.params.routeId,
                request.body,
                request.headers.authorization,
                reply,
            ),
        )

        app.post<{ Params: { routeId: string }; Body: unknown }>(
            '/v1/cross-chain/routes/:routeId/sponsorship/preview',
            { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
            async (request, reply) => {
                try {
                    exactBody(request.body, [], [])
                    return reply.send(await service.previewSponsorship({
                        routeId: request.params.routeId,
                        clientIp: request.ip,
                        signal: abortSignal(request),
                    }))
                } catch (error) {
                    return sendError(
                        reply,
                        error,
                        400,
                        'CROSS_CHAIN_GAS_ASSIST_PREVIEW_FAILED',
                    )
                }
            },
        )

        app.post<{ Params: { routeId: string }; Body: unknown }>(
            '/v1/cross-chain/routes/:routeId/sponsorship/prepare',
            { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
            async (request, reply) => {
                try {
                    exactBody(request.body, [], [])
                    const session = await auth.authenticate(
                        request.headers.authorization,
                    )
                    return reply.send(await service.prepareSponsorship({
                        routeId: request.params.routeId,
                        ownerValue: session.walletAddress,
                        sourceChainId: session.chainId,
                        clientIp: request.ip,
                        idempotencyKey: String(
                            request.headers['idempotency-key'] ?? '',
                        ),
                        signal: abortSignal(request),
                    }))
                } catch (error) {
                    return sendError(
                        reply,
                        error,
                        400,
                        'CROSS_CHAIN_GAS_ASSIST_FAILED',
                    )
                }
            },
        )

        const status = async (
            routeId: string,
            request: FastifyRequest,
            reply: FastifyReply,
        ) => {
            try {
                return reply.send(await service.get(routeId, abortSignal(request)))
            } catch (error) {
                return sendError(reply, error)
            }
        }
        app.get<{ Params: { routeId: string } }>(
            '/v1/cross-chain/status/:routeId',
            (request, reply) => status(request.params.routeId, request, reply),
        )
        app.get<{ Params: { routeId: string } }>(
            '/v1/cross-chain/routes/:routeId',
            (request, reply) => status(request.params.routeId, request, reply),
        )

        for (const action of ['claim', 'submitted'] as const) {
            app.post<{ Params: { routeId: string }; Body: unknown }>(
                `/v1/cross-chain/routes/:routeId/${action}`,
                async (request, reply) => {
                    try {
                        const session = await auth.authenticate(request.headers.authorization)
                        const body = exactBody(
                            request.body,
                            action === 'claim' ? [] : ['sourceTransactionHash'],
                            action === 'claim' ? [] : ['sourceTransactionHash'],
                        )
                        const result = action === 'claim'
                            ? await service.claim(
                                  request.params.routeId,
                                  session.walletAddress,
                                  session.chainId,
                              )
                            : await service.submitted(
                                  request.params.routeId,
                                  session.walletAddress,
                                  body.sourceTransactionHash,
                                  session.chainId,
                              )
                        return reply.send(result)
                    } catch (error) {
                        return sendError(reply, error)
                    }
                },
            )
        }
    }
}

function exactBody(
    value: unknown,
    allowed: string[],
    required: string[] = allowed,
) {
    if (!isRecord(value)) {
        if (allowed.length === 0 && (value === undefined || value === null)) return {}
        throw new Error('A JSON request body is required.')
    }
    const fields = new Set(allowed)
    if (
        Object.keys(value).some((key) => !fields.has(key)) ||
        required.some((key) => !(key in value))
    ) throw new Error('The request contains unsupported or missing fields.')
    return value
}

/*
 * The `Domain:` line names the site the wallet is authenticating to, and it
 * was taken straight from the caller's Host header. Any client could therefore
 * make this service mint a challenge naming an unrelated site it wanted to
 * impersonate — `Domain: some-other-wallet-app.example` — and present that to a
 * victim for signature. Constraining it to the configured origins means the
 * signed message can only ever name a domain this deployment actually serves,
 * so a user or wallet comparing it against the page they are on sees the
 * mismatch.
 *
 * An unrecognised Host falls back to the primary configured origin rather than
 * failing: the message must still name one of our domains, and a reverse proxy
 * forwarding an unexpected Host must not take wallet auth down.
 */
function authDomains(corsOrigins: string[]) {
    return corsOrigins.flatMap((origin) => {
        try {
            return [new URL(origin).host.toLowerCase()]
        } catch {
            return []
        }
    })
}

function requestDomain(host: string | undefined, corsOrigins: string[]) {
    const allowed = authDomains(corsOrigins)
    const requested = host?.trim().toLowerCase() ?? ''
    if (allowed.includes(requested)) return requested
    const primary = allowed[0]
    if (!primary) {
        throw new CrossChainAuthError(
            'AUTH_DOMAIN_INVALID',
            'This deployment has no configured authentication domain.',
            500,
        )
    }
    return primary
}

function sendError(
    reply: { code(statusCode: number): { send(body: unknown): unknown } },
    error: unknown,
    fallbackStatus = 400,
    fallbackCode = 'INVALID_CROSS_CHAIN_REQUEST',
) {
    const explicitStatus =
        typeof error === 'object' && error !== null && 'statusCode' in error &&
        typeof error.statusCode === 'number'
            ? error.statusCode
            : null
    const code =
        typeof error === 'object' && error !== null && 'code' in error &&
        typeof error.code === 'string'
            ? error.code
            : fallbackCode
    const status = explicitStatus ?? (code === 'ROUTE_NOT_FOUND'
        ? 404
        : code.includes('ALREADY') || code.includes('NOT_CLAIMED')
          ? 409
          : fallbackStatus)
    return reply.code(status).send({
        error: {
            code,
            message: error instanceof Error
                ? error.message
                : 'The cross-chain request could not be completed.',
        },
    })
}

export const crossChainRoutes = createCrossChainRoutes()
