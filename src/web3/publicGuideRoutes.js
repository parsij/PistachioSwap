export const PUBLIC_GUIDE_MIGRATIONS = Object.freeze([
    Object.freeze({
        legacy: '/landing/wallet/',
        canonical: '/wallet/',
        source: 'landing/wallet/index.html',
        output: 'wallet/index.html',
    }),
    Object.freeze({
        legacy: '/landing/gas-assist/',
        canonical: '/gas-assist/',
        source: 'landing/gas-assist/index.html',
        output: null,
    }),
    Object.freeze({
        legacy: '/landing/how-it-works/',
        canonical: '/how-it-works/',
        source: 'landing/how-it-works/index.html',
        output: 'how-it-works/index.html',
    }),
    Object.freeze({
        legacy: '/landing/faq/',
        canonical: '/faq/',
        source: 'landing/faq/index.html',
        output: 'faq/index.html',
    }),
])

export function rewritePublicGuideHtml(html) {
    let result = String(html)
    for (const { legacy, canonical } of PUBLIC_GUIDE_MIGRATIONS) {
        result = result.replaceAll(legacy, canonical)
    }
    return result
        .replaceAll('href="../landing.css"', 'href="/landing/landing.css"')
        .replaceAll('href="../guides.css"', 'href="/landing/guides.css"')
}

export function legacyGuideRedirectPath(pathname) {
    const path = String(pathname)
    for (const { legacy, canonical } of PUBLIC_GUIDE_MIGRATIONS) {
        const noSlash = legacy.slice(0, -1)
        if (path === legacy || path === noSlash || path === `${legacy}index.html`) {
            return canonical
        }
    }
    return null
}

export function canonicalGuideRedirectPath(pathname) {
    const path = String(pathname)
    for (const { canonical } of PUBLIC_GUIDE_MIGRATIONS) {
        const noSlash = canonical.slice(0, -1)
        if (path === noSlash || path === `${canonical}index.html`) return canonical
    }
    return null
}

export function canonicalGuideSourcePath(pathname) {
    const path = String(pathname)
    for (const { legacy, canonical, output } of PUBLIC_GUIDE_MIGRATIONS) {
        if (output && path === canonical) return legacy
    }
    return null
}
