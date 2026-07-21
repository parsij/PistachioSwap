import Fastify, { LogController } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'

import { validateStartupConfig } from './config.js'
import { closeDatabase } from './db/client.js'
import { gasAssistErrorBody } from './gas-assist/errors.js'
import { createWalletAuthService } from './gas-assist/prepaid/auth.js'
import { createDurableSponsorshipIntentService } from './gas-assist/prepaid/durable-intent-service.js'
import { assertGasAssistReady } from './gas-assist/readiness.js'
import { gasAssistRoutes } from './modules/gas-assist.js'
import { crossChainRoutes } from './modules/cross-chain.js'
import {
    marketCatalogService,
    marketTokenRoutes,
} from './modules/market-tokens.js'
import { sameChainQuoteRoutes } from './features/quotes/routes/quote-routes.js'
import { tokenDetailsRoutes } from './modules/token-details.js'
import { walletTokenRoutes } from './modules/wallet-tokens.js'
import { sponsorshipRoutes } from './modules/sponsorship.js'
import { sponsorshipAdminRoutes } from './modules/sponsorship-admin.js'
import { sponsorshipRefundAdminRoutes } from './modules/sponsorship-refunds-admin.js'
import { ACTIVE_TOKEN_DISCOVERY_CHAINS } from './token-discovery/registry.js'

const consoleTimeFormatter = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'long',
})

export function createApp() {
    const config = validateStartupConfig()
    const app = Fastify({
        logController: new LogController({ disableRequestLogging: true }),
        logger: {
            timestamp: () => `,"time":${JSON.stringify(
                consoleTimeFormatter.format(new Date()),
            )}`,
            redact: {
                paths: [
                    'req.headers.authorization',
                    'req.headers.x-api-key',
                    'req.headers.0x-api-key',
                    'req.body.signedTransaction',
                    'req.body.signedRawTransaction',
                    'req.body.approvalSignature',
                    'req.body.tradeSignature',
                    'req.body.signature',
                    'req.body.sessionToken',
                ],
                censor: '[REDACTED]',
            },
        },
    })
    let durableSponsorship: ReturnType<
        typeof createDurableSponsorshipIntentService
    > | null = null
    const getDurableSponsorship = () => {
        durableSponsorship ??= createDurableSponsorshipIntentService()
        return durableSponsorship
    }
    let stopMarketCatalogRefresh: (() => void) | null = null
    let stopSponsorshipRecovery: (() => void) | null = null

    app.register(cors, {
        origin(origin, callback) {
            if (!origin || config.corsOrigins.includes(origin)) {
                callback(null, true)
                return
            }

            callback(new Error('Origin is not allowed.'), false)
        },
    })
    app.register(rateLimit, {
        max: 120,
        timeWindow: '1 minute',
    })

    app.addHook('preHandler', async (request, reply) => {
        const route = request.routeOptions.url
        const sponsorshipEnabled = config.sponsorship.enabled
        const submitRoute =
            request.method === 'POST' &&
            route === '/v1/sponsorship/intents/:intentId/submit'
        const orderRoute =
            request.method === 'GET' &&
            route === '/v1/sponsorship/orders/:orderId'

        if (!sponsorshipEnabled || (!submitRoute && !orderRoute)) return

        try {
            const session = await createWalletAuthService().authenticate(
                request.headers.authorization,
            )
            const durable = getDurableSponsorship()
            if (submitRoute) {
                if (config.sponsorship.emergencyDisabled) return
                const body = request.body as
                    | Record<string, unknown>
                    | null
                    | undefined
                const params = request.params as { intentId?: string }
                await durable.captureSignedIntent({
                    intentId: String(params.intentId ?? ''),
                    signedRawTransaction: String(
                        body?.signedRawTransaction ?? '',
                    ),
                    walletAddress: session.walletAddress,
                })
                return
            }

            const params = request.params as { orderId?: string }
            await durable.reconcileOrder(
                String(params.orderId ?? ''),
                session.walletAddress,
            )
        } catch (error) {
            const response = gasAssistErrorBody(error)
            return reply.code(response.statusCode).send(response.body)
        }
    })

    app.register(marketTokenRoutes)
    app.register(walletTokenRoutes)
    app.register(sameChainQuoteRoutes)
    app.register(crossChainRoutes)
    app.register(tokenDetailsRoutes)
    app.register(gasAssistRoutes)
    app.register(sponsorshipRoutes)
    app.register(sponsorshipAdminRoutes)
    app.register(sponsorshipRefundAdminRoutes)

    app.addHook('onReady', async () => {
        await assertGasAssistReady()
        if (process.env.NODE_ENV !== 'test') {
            if (config.sponsorship.enabled) {
                const durable = getDurableSponsorship()
                let recoveryRunning = false
                const runRecovery = async () => {
                    if (recoveryRunning) return
                    recoveryRunning = true
                    try {
                        const summary = await durable.recoverPendingIntents()
                        if (summary.reconciled > 0 ||
                            summary.rebroadcast > 0 ||
                            summary.failed > 0) {
                            app.log.info({
                                subsystem: 'sponsorship-recovery',
                                ...summary,
                            }, 'Durable sponsorship intents reconciled')
                        }
                    } catch (error) {
                        app.log.warn({
                            subsystem: 'sponsorship-recovery',
                            err: error,
                        }, 'Durable sponsorship recovery pass failed')
                    } finally {
                        recoveryRunning = false
                    }
                }
                const interval = setInterval(
                    () => void runRecovery(),
                    5_000,
                )
                interval.unref()
                void runRecovery()
                stopSponsorshipRecovery = () => clearInterval(interval)
            }

            marketCatalogService.setPersistenceWarningHandler((code) => {
                app.log.warn({
                    subsystem: 'market-catalog-persistence',
                    code,
                }, 'Market catalog persistence is degraded')
            })
            const hydration = await marketCatalogService.hydratePersistentCatalogs()
            app.log.info({
                subsystem: 'market-catalog-persistence',
                loadedCatalogs: hydration.loaded,
                ignoredCatalogs: hydration.ignored,
                degraded: hydration.degraded,
            }, 'Market catalog cache hydration completed')
            if (ACTIVE_TOKEN_DISCOVERY_CHAINS.length > 30) {
                app.log.warn({
                    activeChainCount: ACTIVE_TOKEN_DISCOVERY_CHAINS.length,
                    refreshIntervalMs: 60_000,
                }, 'Market catalog rolling refresh cannot meet the 30-minute target')
            }
            stopMarketCatalogRefresh =
                marketCatalogService.startRollingRefresh()
        }
    })
    app.addHook('onClose', async () => {
        stopSponsorshipRecovery?.()
        stopSponsorshipRecovery = null
        stopMarketCatalogRefresh?.()
        stopMarketCatalogRefresh = null
        marketCatalogService.setPersistenceWarningHandler(null)
        await closeDatabase()
    })

    app.get('/health', async () => ({
        status: 'ok',
        chainId: config.chainId,
    }))

    app.setErrorHandler((error, request, reply) => {
        const errorInfo =
            typeof error === 'object' && error !== null
                ? (error as {
                      code?: string
                      statusCode?: number
                  })
                : {}

        request.log.warn(
            {
                code: errorInfo.code,
                statusCode: errorInfo.statusCode,
            },
            'Request failed',
        )

        const statusCode =
            errorInfo.statusCode && errorInfo.statusCode < 500
                ? errorInfo.statusCode
                : 500

        return reply.code(statusCode).send({
            error: {
                code:
                    statusCode === 429
                        ? 'RATE_LIMITED'
                        : 'REQUEST_FAILED',
                message:
                    statusCode === 429
                        ? 'Too many requests.'
                        : 'The request could not be completed.',
            },
        })
    })

    return app
}
