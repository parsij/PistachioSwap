export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const ICON_CACHE_CONTROL = 'public, max-age=604800'
export const HTML_NO_STORE = 'no-store, must-revalidate'
export const API_NO_STORE = 'no-store'

const ICON_EXACT_PATHS = new Set([
    '/favicon.svg',
    '/favicon.png',
    '/favicon.ico',
    '/apple-touch-icon.png',
    '/apple-touch-icon.ico',
    '/site.webmanifest',
    '/og-image.png',
])

export function isHashedAssetPath(pathname) {
    return String(pathname).startsWith('/assets/')
}

export function isIconPath(pathname) {
    const path = String(pathname).split('?')[0]
    return (
        ICON_EXACT_PATHS.has(path) ||
        path.startsWith('/icons/') ||
        path.startsWith('/networkIcons/')
    )
}

export function isApiPath(pathname) {
    const path = String(pathname).split('?')[0]
    return path === '/api' || path.startsWith('/api/')
}

export function isAppHtmlPath(pathname) {
    const path = String(pathname).split('?')[0]
    return path === '/' || path === '/index.html'
}

export function cacheControlForPath(pathname) {
    if (isApiPath(pathname)) return API_NO_STORE
    if (isAppHtmlPath(pathname)) return HTML_NO_STORE
    if (isHashedAssetPath(pathname)) return ASSET_CACHE_CONTROL
    if (isIconPath(pathname)) return ICON_CACHE_CONTROL
    if (
        String(pathname).startsWith('/landing/') ||
        String(pathname).startsWith('/gas-assist/') ||
        String(pathname).endsWith('.html')
    ) {
        return HTML_NO_STORE
    }
    return null
}

export function applyCacheControl(headers, pathname) {
    const value = cacheControlForPath(pathname)
    if (!value) return headers
    headers.set('Cache-Control', value)
    if (value.includes('no-store')) {
        headers.set('CDN-Cache-Control', 'no-store')
        headers.set('Cloudflare-CDN-Cache-Control', 'no-store')
    } else {
        headers.set('CDN-Cache-Control', value)
        headers.set('Cloudflare-CDN-Cache-Control', value)
    }
    return headers
}
