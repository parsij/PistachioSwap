import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { shouldServeLandingHtml } from './botUserAgent.js'
import { HTML_NO_STORE } from './originCacheHeaders.js'

export function createCrawlerLandingMiddleware(rootDir = process.cwd()) {
    const landingCandidates = [
        resolve(rootDir, 'dist/landing/index.html'),
        resolve(rootDir, 'landing/index.html'),
    ]

    return function crawlerLandingMiddleware(req, res, next) {
        const pathname = String(req.url ?? '/').split('?')[0]
        if (!shouldServeLandingHtml({
            userAgent: req.headers['user-agent'],
            pathname,
        })) {
            return next()
        }

        let html
        for (const landingPath of landingCandidates) {
            try {
                html = readFileSync(landingPath, 'utf8')
                break
            } catch {
                html = undefined
            }
        }
        if (!html) {
            res.statusCode = 302
            res.setHeader('Location', '/landing/')
            res.setHeader('Cache-Control', HTML_NO_STORE)
            res.end()
            return
        }

        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', HTML_NO_STORE)
        res.end(html)
    }
}

export function crawlerLandingPlugin() {
    return {
        name: 'crawler-landing-html',
        configureServer(server) {
            server.middlewares.use(createCrawlerLandingMiddleware())
        },
        configurePreviewServer(server) {
            server.middlewares.use(createCrawlerLandingMiddleware())
        },
    }
}
