import Fastify, { LogController } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'

import { validateStartupConfig } from './config.js'
import { marketTokenRoutes } from './modules/market-tokens.js'
import { quoteRoutes } from './modules/quotes.js'
import { tokenDetailsRoutes } from './modules/token-details.js'
import { walletTokenRoutes } from './modules/wallet-tokens.js'

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
                ],
                censor: '[REDACTED]',
            },
        },
    })

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
    app.register(tokenDetailsRoutes)

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
