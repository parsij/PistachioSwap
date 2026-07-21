import type { FastifyPluginAsync, FastifyReply } from 'fastify'

import { getApiConfig } from '../config.js'
import { GasAssistError, gasAssistErrorBody } from '../gas-assist/errors.js'
import { createWalletAuthService } from '../gas-assist/prepaid/auth.js'
import { createSponsorshipIntentService } from '../gas-assist/prepaid/intent-service.js'
import { createSponsorshipOrderService } from '../gas-assist/prepaid/order-service.js'
import { createSponsorshipPackageService } from '../gas-assist/prepaid/package-service.js'

function exactObject(value: unknown, allowed: string[], required: string[] = allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        if (allowed.length === 0 && (value === undefined || value === null)) return {}
        throw new GasAssistError('INVALID_REQUEST', 'A JSON request body is required.')
    }
    const record = value as Record<string, unknown>
    const allowedFields = new Set(allowed)
    if (Object.keys(record).some((key) => !allowedFields.has(key)) ||
        required.some((key) => !(key in record))) {
        throw new GasAssistError('INVALID_REQUEST', 'The request contains unsupported or missing fields.')
    }
    return record
}

async function safe<T>(handler: () => Promise<T>, reply: FastifyReply) {
    try {
        return await handler()
    } catch (error) {
        const response = gasAssistErrorBody(error)
        return reply.code(response.statusCode).send(response.body)
    }
}

function requestDomain(hostname: string, host: string | undefined) {
    return host?.trim().toLowerCase() || hostname.toLowerCase()
}

export const sponsorshipRoutes: FastifyPluginAsync = async (app) => {
    const auth = () => createWalletAuthService()
    const orders = () => createSponsorshipOrderService()
    const intents = () => createSponsorshipIntentService()
    const packages = () => createSponsorshipPackageService()

    app.get('/v1/sponsorship/config', async () => {
        const config = getApiConfig().sponsorship
        return {
            enabled: config.enabled && !config.emergencyDisabled,
            chainId: 56,
            orderTtlSeconds: config.orderTtlSeconds,
            actionIntentTtlSeconds: config.actionIntentTtlSeconds,
            packageTtlSeconds: 15 * 60,
            gasMultiplierBps: config.gasMultiplierBps,
            fixedFeeUsd: config.fixedFeeUsd,
            platformFeeBps: config.platformFeeBps,
            commercialFeeCapUsd: config.commercialFeeCapUsd,
            approvalSponsorshipEnabled: config.approvalSponsorEnabled,
            normalSwapSponsorshipEnabled: config.normalSwapSponsorEnabled,
            walletDailyOrderLimit: config.walletDailyOrderLimit,
        }
    })

    app.post<{ Body: unknown }>(
        '/v1/sponsorship/auth/challenge',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        (request, reply) => safe(async () => {
            const body = exactObject(request.body, ['walletAddress', 'chainId'])
            return auth().createChallenge({
                walletAddress: String(body.walletAddress ?? ''),
                chainId: Number(body.chainId),
                domain: requestDomain(request.hostname, request.headers.host),
            })
        }, reply),
    )

    app.post<{ Body: unknown }>(
        '/v1/sponsorship/auth/verify',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        (request, reply) => safe(async () => {
            const body = exactObject(request.body, ['challengeId', 'signature'])
            return auth().verifyChallenge({
                challengeId: String(body.challengeId ?? ''),
                signature: String(body.signature ?? ''),
                domain: requestDomain(request.hostname, request.headers.host),
            })
        }, reply),
    )

    app.post<{ Body: unknown }>(
        '/v1/sponsorship/orders',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        (request, reply) => safe(async () => {
            const session = await auth().authenticate(request.headers.authorization)
            const body = exactObject(request.body, [
                'sellToken',
                'buyToken',
                'grossInputAmount',
                'slippageBps',
            ])
            return orders().create({
                input: {
                    sellToken: String(body.sellToken ?? ''),
                    buyToken: String(body.buyToken ?? ''),
                    grossInputAmount: String(body.grossInputAmount ?? ''),
                    slippageBps: Number(body.slippageBps),
                },
                walletAddress: session.walletAddress,
                clientIp: request.ip,
                idempotencyKey: String(request.headers['idempotency-key'] ?? ''),
            })
        }, reply),
    )

    app.post<{ Params: { orderId: string }; Body: unknown }>(
        '/v1/sponsorship/orders/:orderId/package/prepare',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        (request, reply) => safe(async () => {
            exactObject(request.body, [], [])
            const session = await auth().authenticate(request.headers.authorization)
            return packages().prepare(
                request.params.orderId,
                session.walletAddress,
            )
        }, reply),
    )

    app.post<{ Params: { orderId: string }; Body: unknown }>(
        '/v1/sponsorship/orders/:orderId/package/submit',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        (request, reply) => safe(async () => {
            const body = exactObject(request.body, ['signedTransactions'])
            if (!Array.isArray(body.signedTransactions)) {
                throw new GasAssistError(
                    'INVALID_REQUEST',
                    'signedTransactions must be an array.',
                )
            }
            const session = await auth().authenticate(request.headers.authorization)
            return packages().submitSignedPackage({
                orderId: request.params.orderId,
                walletAddress: session.walletAddress,
                clientIp: request.ip,
                signedTransactions: body.signedTransactions.map((value) => {
                    const item = exactObject(value, [
                        'intentId',
                        'action',
                        'signedRawTransaction',
                    ])
                    return {
                        intentId: String(item.intentId ?? ''),
                        action: String(item.action ?? '') as
                            | 'fee-payment-transfer'
                            | 'token-approval'
                            | 'normal-swap',
                        signedRawTransaction: String(
                            item.signedRawTransaction ?? '',
                        ),
                    }
                }),
            })
        }, reply),
    )

    app.post<{ Params: { orderId: string }; Body: unknown }>(
        '/v1/sponsorship/orders/:orderId/payment/prepare',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        (request, reply) => safe(async () => {
            exactObject(request.body, [], [])
            const session = await auth().authenticate(request.headers.authorization)
            return intents().preparePayment(request.params.orderId, session.walletAddress)
        }, reply),
    )

    app.post<{ Params: { orderId: string }; Body: unknown }>(
        '/v1/sponsorship/orders/:orderId/approval/prepare',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        (request, reply) => safe(async () => {
            const body = exactObject(request.body, ['reusableApproval'], [])
            const session = await auth().authenticate(request.headers.authorization)
            return intents().prepareApproval(
                request.params.orderId,
                session.walletAddress,
                body.reusableApproval === true,
            )
        }, reply),
    )

    app.post<{ Params: { intentId: string }; Body: unknown }>(
        '/v1/sponsorship/intents/:intentId/submit',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        (request, reply) => safe(async () => {
            const body = exactObject(request.body, ['signedRawTransaction'])
            const session = await auth().authenticate(request.headers.authorization)
            return intents().submit({
                intentId: request.params.intentId,
                signedRawTransaction: String(body.signedRawTransaction ?? '') as `0x${string}`,
                walletAddress: session.walletAddress,
                clientIp: request.ip,
            })
        }, reply),
    )

    app.post<{ Params: { orderId: string }; Body: unknown }>(
        '/v1/sponsorship/orders/:orderId/continuation',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        (request, reply) => safe(async () => {
            exactObject(request.body, [], [])
            const session = await auth().authenticate(request.headers.authorization)
            return intents().prepareContinuation(request.params.orderId, session.walletAddress, request.ip)
        }, reply),
    )

    app.get<{ Params: { orderId: string } }>(
        '/v1/sponsorship/orders/:orderId',
        { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
        (request, reply) => safe(async () => {
            const session = await auth().authenticate(request.headers.authorization)
            const refreshed = await intents().refreshOrder(request.params.orderId, session.walletAddress)
            return {
                ...(await orders().get(request.params.orderId, session.walletAddress)),
                currentRequiredAction: refreshed.currentRequiredAction,
                confirmationCount: refreshed.confirmationCount,
                preSignedPackage: refreshed.preSignedPackage ?? false,
            }
        }, reply),
    )
}

export const sponsorshipRouteInternals = {
    exactObject,
}
