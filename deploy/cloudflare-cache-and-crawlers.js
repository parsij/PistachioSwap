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
 *   / and /index.html   no-store
 *   /api/*              no-store
 *
 * Crawlers requesting / receive /landing/ HTML (no wallet JavaScript).
 */

const BOT_USER_AGENT_PATTERN = /Googlebot|Google-Extended|GoogleOther|bingbot|BingPreview|GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|anthropic-ai|PerplexityBot|CCBot|Bytespider|Applebot|Amazonbot|Slurp|DuckDuckBot|YandexBot|Baiduspider|facebookexternalhit|meta-externalagent/i

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

function isBotUserAgent(userAgent) {
    return BOT_USER_AGENT_PATTERN.test(String(userAgent ?? ''))
}

function cacheControlForPath(pathname) {
    if (pathname === '/api' || pathname.startsWith('/api/')) return API_NO_STORE
    if (pathname === '/' || pathname === '/index.html') return HTML_NO_STORE
    if (pathname.startsWith('/assets/')) return ASSET_CACHE_CONTROL
    if (
        ICON_EXACT_PATHS.has(pathname) ||
        pathname.startsWith('/icons/') ||
        pathname.startsWith('/networkIcons/')
    ) {
        return ICON_CACHE_CONTROL
    }
    if (pathname.startsWith('/landing/') || pathname.endsWith('.html')) {
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
        const userAgent = request.headers.get('user-agent') || ''
        const bypass = request.headers.get('x-pistachio-bypass') === '1'

        if (
            !bypass &&
            isBotUserAgent(userAgent) &&
            (pathname === '/' || pathname === '/index.html')
        ) {
            const headers = new Headers(request.headers)
            headers.set('x-pistachio-bypass', '1')
            const landing = await fetch(new Request(new URL('/landing/', url), {
                method: 'GET',
                headers,
                redirect: 'follow',
            }))
            return withCacheHeaders(landing, '/')
        }

        const response = await fetch(request)
        return withCacheHeaders(response, pathname)
    },
}
