import Fastify, { LogController } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'

import { validateStartupConfig } from './config.js'
import { closeDatabase } from './db/client.js'
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
    let stopMarketCatalogRefresh: (() => void) | null = null

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
    app.register(marketTokenRoutes)
    app.register(walletTokenRoutes)
    app.register(sameChainQuoteRoutes)
    app.register(crossChainRoutes)
    app.register(tokenDetailsRoutes)
    app.register(gasAssistRoutes)
    app.register(sponsorshipRoutes)

    app.addHook('onReady', async () => {
        await assertGasAssistReady()
        if (process.env.NODE_ENV !== 'test') {
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
