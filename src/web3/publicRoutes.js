// Only exact legacy entry points move. Never redirect /landing/* guides to home.
export function publicRouteRedirect(url) {
    let pathname
    if (url.pathname === '/' || url.pathname === '/index.html') {
        if (url.searchParams.get('route')) pathname = '/swap/'
        else if (url.pathname === '/index.html') pathname = '/'
    } else if (['/landing', '/landing/', '/landing/index.html'].includes(url.pathname)) {
        pathname = '/'
    } else if (url.pathname === '/swap' || url.pathname === '/swap/index.html') {
        pathname = '/swap/'
    }
    return pathname ? pathname + url.search + url.hash : null
}
