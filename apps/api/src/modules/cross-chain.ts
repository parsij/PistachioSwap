import type {
    FastifyPluginAsync,
    FastifyReply,
    FastifyRequest,
} from 'fastify'

import {
    getCrossChainAuthService,
    type CrossChainAuthService,
} from '../cross-chain/auth.js'
import { CrossChainRouteService } from '../cross-chain/service.js'
import {
    CROSS_CHAIN_PROVIDERS,
    type CrossChainProviderName,
} from '../cross-chain/types.js'
import { validateCrossChainRequest } from '../cross-chain/validation.js'
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
                        domain: requestDomain(request.hostname, request.headers.host),
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
                        domain: requestDomain(request.hostname, request.headers.host),
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
                return reply.send(await service.quote(normalized, abortSignal(request)))
            } catch (error) {
                return sendError(reply, error, 503, 'NO_CROSS_CHAIN_ROUTE')
            }
        }
        app.post<{ Body: unknown }>('/v1/cross-chain/quote', quoteHandler)
        app.post<{ Body: unknown }>('/v1/cross-chain/routes', quoteHandler)

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

function requestDomain(hostname: string, host: string | undefined) {
    return host?.trim().toLowerCase() || hostname.toLowerCase()
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
