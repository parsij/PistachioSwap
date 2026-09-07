import { publicRouteRedirect, publicRouteSourcePath } from './publicRoutes.js'

export function createPublicRoutesMiddleware({ rewriteCanonicalSources = true } = {}) {
    return function publicRoutesMiddleware(req, res, next) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next()
        const url = new URL(req.url, 'http://localhost')
        const target = publicRouteRedirect(url)
        if (target) {
            res.statusCode = 301
            res.setHeader('Location', target)
            // Avoid sticky local redirects and let production cache policy be explicit.
            res.setHeader('Cache-Control', 'no-store')
            res.end()
            return
        }
        if (rewriteCanonicalSources) {
            const sourcePath = publicRouteSourcePath(url)
            if (sourcePath) req.url = sourcePath + url.search
        }
        next()
    }
}

export function publicRoutesPlugin() {
    return {
        name: 'public-canonical-routes',
        configureServer(server) {
            server.middlewares.use(createPublicRoutesMiddleware())
        },
        configurePreviewServer(server) {
            server.middlewares.use(createPublicRoutesMiddleware({ rewriteCanonicalSources: false }))
        },
    }
}
