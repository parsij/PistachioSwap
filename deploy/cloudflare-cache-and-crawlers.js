/**
 * Optional Cloudflare Worker for pistachioswap.com.
 *
 * Skip this if you merged deploy/nginx-origin-cache.conf into origin nginx.
 * Nginx Cache-Control is enough: Cloudflare honors origin TTLs for JS/CSS/images.
 *
 * Use this Worker only when you cannot edit nginx. Then:
 *   Workers & Pages → Create → paste this file →
 *   Add route pistachioswap.com/* (and www if used).
 *
 * Cache-Control:
 *   /assets/*           1 year, immutable
 *   icons/favicons      1 week
 *   / and /swap/        no-store
 *   /api/*              no-store
 *
 * All visitors receive the same document for a URL. Public product guides are
 * static HTML at / and under /landing/. The wallet is at /swap/.
 * This example requires the new dist/swap/index.html at the origin first.
 * Do not rewrite / based on User-Agent.
 */

const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const ICON_CACHE_CONTROL = 'public, max-age=604800'
const HTML_NO_STORE = 'no-store, must-revalidate'
const API_NO_STORE = 'no-store'

const ICON_EXACT_PATHS = new Set([
    '/favicon.svg',
    '/favicon.png',
    '/favicon.ico',
    '/apple-touch-icon.png',
    '/apple-touch-icon.ico',
    '/site.webmanifest',
    '/og-image.png',
])

function cacheControlForPath(pathname) {
    if (pathname === '/api' || pathname.startsWith('/api/')) return API_NO_STORE
    if (pathname === '/' || pathname === '/index.html' || pathname === '/swap' || pathname === '/swap/' || pathname === '/swap/index.html') return HTML_NO_STORE
    if (pathname.startsWith('/assets/')) return ASSET_CACHE_CONTROL
    if (
        ICON_EXACT_PATHS.has(pathname) ||
        pathname.startsWith('/icons/') ||
        pathname.startsWith('/networkIcons/')
    ) {
        return ICON_CACHE_CONTROL
    }
    if (
        pathname.startsWith('/landing/') ||
        pathname.startsWith('/gas-assist/') ||
        pathname.endsWith('.html')
    ) {
        return HTML_NO_STORE
    }
    return null
}

function withCacheHeaders(response, pathname) {
    const headers = new Headers(response.headers)
    const value = cacheControlForPath(pathname)
    if (value) {
        headers.set('Cache-Control', value)
        const cdnValue = value.includes('no-store') ? 'no-store' : value
        headers.set('CDN-Cache-Control', cdnValue)
        headers.set('Cloudflare-CDN-Cache-Control', cdnValue)
    }
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    })
}

export default {
    async fetch(request) {
        const url = new URL(request.url)
        const pathname = url.pathname
        // Kept inline so this file can still be pasted into the Worker editor.
        // src/web3/publicRoutes.test.js verifies parity with the Vite/browser rules.
        if (request.method === 'GET' || request.method === 'HEAD') {
            let target
            if (pathname === '/' || pathname === '/index.html') {
                if (url.searchParams.get('route')) target = '/swap/'
                else if (pathname === '/index.html') target = '/'
            } else if (['/landing', '/landing/', '/landing/index.html'].includes(pathname)) {
                target = '/'
            } else if (pathname === '/swap' || pathname === '/swap/index.html') {
                target = '/swap/'
            }
            if (target) {
                url.pathname = target
                return new Response(null, {
                    status: 301,
                    headers: {
                        Location: url.toString(),
                        'Cache-Control': 'no-store',
                    },
                })
            }
        }
        const response = await fetch(request)
        return withCacheHeaders(response, pathname)
    },
}
