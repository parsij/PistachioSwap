import { publicRouteRedirect } from './publicRoutes.js'

export function createPublicRoutesMiddleware() {
    return function publicRoutesMiddleware(req, res, next) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next()
        const target = publicRouteRedirect(new URL(req.url, 'http://localhost'))
        if (!target) return next()
        res.statusCode = 301
        res.setHeader('Location', target)
        // Avoid sticky local redirects and let production cache policy be explicit.
        res.setHeader('Cache-Control', 'no-store')
        res.end()
    }
}

export function publicRoutesPlugin() {
    return {
        name: 'public-canonical-routes',
        configureServer(server) {
            server.middlewares.use(createPublicRoutesMiddleware())
        },
        configurePreviewServer(server) {
            server.middlewares.use(createPublicRoutesMiddleware())
        },
    }
}
