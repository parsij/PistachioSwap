import {
    canonicalGuideRedirectPath,
    canonicalGuideSourcePath,
    legacyGuideRedirectPath,
} from './publicGuideRoutes.js'

export function publicRouteRedirect(url) {
    let pathname
    if (url.pathname === '/' || url.pathname === '/index.html') {
        if (url.searchParams.get('route')) pathname = '/swap/'
        else if (url.pathname === '/index.html') pathname = '/'
    } else if (['/landing', '/landing/', '/landing/index.html'].includes(url.pathname)) {
        pathname = '/'
    } else if (url.pathname === '/swap' || url.pathname === '/swap/index.html') {
        pathname = '/swap/'
    } else {
        pathname = legacyGuideRedirectPath(url.pathname)
            || canonicalGuideRedirectPath(url.pathname)
    }
    return pathname ? pathname + url.search + url.hash : null
}

export function publicRouteSourcePath(url) {
    return canonicalGuideSourcePath(url.pathname)
}
