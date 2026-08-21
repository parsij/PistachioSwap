import { cacheControlForPath } from './originCacheHeaders.js'

export function createOriginCacheMiddleware() {
    return function originCacheMiddleware(req, res, next) {
        const pathname = String(req.url ?? '/').split('?')[0]
        const value = cacheControlForPath(pathname)
        if (value) res.setHeader('Cache-Control', value)
        next()
    }
}

export function originCacheHeadersPlugin() {
    return {
        name: 'origin-cache-headers',
        configureServer(server) {
            server.middlewares.use(createOriginCacheMiddleware())
        },
        configurePreviewServer(server) {
            server.middlewares.use(createOriginCacheMiddleware())
        },
    }
}
