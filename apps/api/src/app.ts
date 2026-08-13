import Fastify, {
    type FastifyInstance,
    LogController,
} from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'

import { validateStartupConfig } from './config.js'
import { closeDatabase } from './db/client.js'
import { crossChainRoutes } from './modules/cross-chain.js'
import { gasAssistProxyRoutes } from './modules/gas-assist-proxy.js'
import {
    marketCatalogService,
    marketTokenRoutes,
} from './modules/market-tokens.js'
import {
    getUniswapVolumeCatalog,
    loadPersistedUniswapVolumeCatalog,
    uniswapVolumeTokenRoutes,
} from './modules/uniswap-volume-tokens.js'
import { sameChainQuoteRoutes } from './features/quotes/routes/quote-routes.js'
import { tokenDetailsRoutes } from './modules/token-details.js'
import { tokenCatalogRoutes } from './modules/token-catalog.js'
import { walletTokenKnownBalanceRoutes } from './modules/wallet-token-known-balances.js'
import { walletTokenRoutes } from './modules/wallet-tokens.js'
import { walletActivityRoutes } from './modules/wallet-activity.js'
import type { WalletToken } from './providers/alchemy/wallet-tokens.js'
import {
    dexScreenerWalletPriceCache,
} from './providers/dexscreener/wallet-price-cache.js'
import { ACTIVE_TOKEN_DISCOVERY_CHAINS } from './token-discovery/registry.js'
import { loadShapeShiftAssetCatalog } from './token-discovery/shapeshift-asset-catalog.js'

const consoleTimeFormatter = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'long',
})

const SENSITIVE_API_PREFIXES = [
    '/v1/gas-assist',
    '/v1/sponsorship',
    '/v1/cross-chain',
    '/v1/wallet-activity',
    '/v1/wallet-token',
]

function canonicalRoutePath(route: string) {
    return route.startsWith('/api/') ? route.slice('/api'.length) : route
}

function registerApiRoutes(app: FastifyInstance, prefix = '') {
    app.register(marketTokenRoutes, { prefix })
    app.register(uniswapVolumeTokenRoutes, { prefix })
    app.register(tokenCatalogRoutes, { prefix })
    app.register(walletTokenRoutes, { prefix })
    app.register(walletActivityRoutes, { prefix })
    app.register(walletTokenKnownBalanceRoutes, { prefix })
    app.register(sameChainQuoteRoutes, { prefix })
    app.register(crossChainRoutes, { prefix })
    app.register(tokenDetailsRoutes, { prefix })
    app.register(gasAssistProxyRoutes, { prefix })
}

function readTrustProxy() {
    const raw = process.env.TRUST_PROXY_HOPS?.trim()
    if (!raw || raw === '0') return false
    const hops = Number(raw)
    if (!Number.isSafeInteger(hops) || hops < 1 || hops > 4) {
        throw new Error('TRUST_PROXY_HOPS must be an integer from 0 through 4.')
    }
    return hops
}

function failClosedWalletPrices(tokens: WalletToken[]) {
    return tokens.map((token) => ({
        ...token,
        priceUSD: null,
        trustedPriceUSD: null,
        marketPriceUSD: null,
        valueUSD: null,
        estimatedSellValueUsd: null,
        priceConfidence: 'unknown' as const,
        includeInPortfolioValue: false,
    }))
}

export function createApp() {
    const config = validateStartupConfig()
    const app = Fastify({
        bodyLimit: 512 * 1024,
        connectionTimeout: 15_000,
        logController: new LogController({ disableRequestLogging: true }),
        routerOptions: {
            maxParamLength: 160,
        },
        maxRequestsPerSocket: 1_000,
        onConstructorPoisoning: 'error',
        onProtoPoisoning: 'error',
        requestTimeout: 30_000,
        trustProxy: readTrustProxy(),
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
                    'req.body.signedTransactions[*].signedRawTransaction',
                    'req.body.approvalSignature',
                    'req.body.tradeSignature',
                    'req.body.signature',
                    'req.body.sessionToken',
                    'req.body.privateKey',
                    'req.body.recoveryPhrase',
                    'req.body.mnemonic',
                    'req.body.keystore',
                    'req.body.password',
                    'req.body.backup',
                    'req.body.encryptedBackup',
                    'req.body.challenge',
                    'req.body.credential',
                ],
                censor: '[REDACTED]',
            },
        },
    })
    let stopMarketCatalogRefresh: (() => void) | null = null

    app.register(cors, {
        allowedHeaders: [
            'authorization',
            'content-type',
            'x-api-key',
            '0x-api-key',
        ],
        credentials: false,
        exposedHeaders: [
            'retry-after',
            'x-ratelimit-limit',
            'x-ratelimit-remaining',
            'x-ratelimit-reset',
        ],
        maxAge: 600,
        methods: ['GET', 'POST', 'OPTIONS'],
        origin(origin, callback) {
            if (!origin || config.corsOrigins.includes(origin)) {
                callback(null, true)
                return
            }

            callback(new Error('Origin is not allowed.'), false)
        },
    })
    app.register(rateLimit, {
        max: 90,
        timeWindow: '1 minute',
    })

    app.addHook('onSend', async (request, reply, payload) => {
        reply.header('x-content-type-options', 'nosniff')
        reply.header('referrer-policy', 'no-referrer')
        reply.header('cross-origin-resource-policy', 'same-site')
        const route = canonicalRoutePath(String(request.routeOptions.url ?? ''))
        if (SENSITIVE_API_PREFIXES.some((prefix) => route.startsWith(prefix))) {
            reply.header('cache-control', 'private, no-store, max-age=0')
            reply.header('pragma', 'no-cache')
        }
        return payload
    })

    app.addHook('preSerialization', async (request, _reply, payload) => {
        const route = canonicalRoutePath(
            String(request.routeOptions.url ?? ''),
        )
        if (
            process.env.NODE_ENV === 'test' ||
            route !== '/v1/wallet-tokens' ||
            typeof payload !== 'object' ||
            payload === null
        ) return payload

        const response = payload as Record<string, unknown>
        if (!Array.isArray(response.tokens)) return payload
        const tokens = response.tokens as WalletToken[]
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 3_000)
        timeout.unref()
        try {
            const pricedTokens = await dexScreenerWalletPriceCache.enrichWalletTokens(
                tokens,
                controller.signal,
            )
            return { ...response, tokens: pricedTokens }
        } catch (error) {
            request.log.warn({
                subsystem: 'wallet-price-cache',
                err: error,
            }, 'Wallet price enrichment failed closed')
            return { ...response, tokens: failClosedWalletPrices(tokens) }
        } finally {
            clearTimeout(timeout)
        }
    })

    registerApiRoutes(app)
    registerApiRoutes(app, '/api')

    app.addHook('onReady', async () => {
        if (process.env.NODE_ENV !== 'test') {
            marketCatalogService.setPersistenceWarningHandler((code) => {
                app.log.warn({
                    subsystem: 'market-catalog-persistence',
                    code,
                }, 'Market catalog persistence is degraded')
            })
            const hydration = await marketCatalogService.hydratePersistentCatalogs()
            const uniswapHydration = await loadPersistedUniswapVolumeCatalog()
            const shapeShiftHydration = await loadShapeShiftAssetCatalog()
            const walletPriceHydration =
                await dexScreenerWalletPriceCache.hydrate()
            void getUniswapVolumeCatalog({ refreshIfStale: true })
            app.log.info({
                subsystem: 'market-catalog-persistence',
                loadedCatalogs: hydration.loaded,
                ignoredCatalogs: hydration.ignored,
                degraded: hydration.degraded,
                uniswapVolumeCatalogLoaded:
                    uniswapHydration ? uniswapHydration.tokens.length : 0,
                shapeShiftAssetCatalogSource: shapeShiftHydration.source,
                shapeShiftAssetCatalogLoaded:
                    shapeShiftHydration.catalog ? shapeShiftHydration.catalog.ids.length : 0,
                walletPriceCacheLoaded: walletPriceHydration.loaded,
                walletPriceCacheIgnored: walletPriceHydration.ignored,
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
        if (process.env.NODE_ENV !== 'test') {
            try {
                await dexScreenerWalletPriceCache.flush()
            } catch (error) {
                app.log.warn({
                    subsystem: 'wallet-price-cache',
                    err: error,
                }, 'Wallet price cache could not be persisted during shutdown')
            }
        }
        await closeDatabase()
    })

    const healthOptions = {
        config: {
            rateLimit: { max: 30, timeWindow: '1 minute' },
        },
    }
    const healthHandler = async () => ({
        status: 'ok',
        chainId: config.chainId,
    })

    app.get('/health', healthOptions, healthHandler)
    app.get('/api/health', healthOptions, healthHandler)

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
