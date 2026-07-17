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
import { quoteRoutes } from './modules/quotes.js'
import { tokenDetailsRoutes } from './modules/token-details.js'
import { walletTokenRoutes } from './modules/wallet-tokens.js'
import { sponsorshipRoutes } from './modules/sponsorship.js'

export function createApp() {
    const config = validateStartupConfig()
    const app = Fastify({
        logController: new LogController({ disableRequestLogging: true }),
        logger: {
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
    app.register(quoteRoutes)
    app.register(crossChainRoutes)
    app.register(tokenDetailsRoutes)
    app.register(gasAssistRoutes)
    app.register(sponsorshipRoutes)

    app.addHook('onReady', async () => {
        await assertGasAssistReady()
        if (process.env.NODE_ENV !== 'test') {
            app.log.info('Warming token catalogs in the background')
            void marketCatalogService.refreshAllCatalogs()
                .then((catalog) => {
                    app.log.info({
                        tokenCount: catalog.tokens.length,
                        unavailableChainIds: catalog.unavailableChainIds,
                    }, 'Token catalog warmup completed')
                })
                .catch((error) => {
                    app.log.warn({
                        code: error?.code ?? 'TOKEN_CATALOG_WARMUP_FAILED',
                    }, 'Token catalog warmup will retry on the hourly schedule')
                })
            stopMarketCatalogRefresh =
                marketCatalogService.startHourlyRefresh(
                    60 * 60 * 1000,
                    { refreshImmediately: false },
                )
        }
    })
    app.addHook('onClose', async () => {
        stopMarketCatalogRefresh?.()
        stopMarketCatalogRefresh = null
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
