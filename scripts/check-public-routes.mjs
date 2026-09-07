import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// Read-only HTTP acceptance check. Pass the local preview or deployed origin.
const origin = new URL(process.argv[2] || 'http://127.0.0.1:5176').origin
const canonicalOrigin = 'https://pistachioswap.com'
const pages = ['/', '/swap/', '/landing/wallet/', '/landing/how-it-works/',
    '/landing/gas-assist/', '/gas-assist/', '/landing/faq/']
const redirects = [
    ['/landing', '/'],
    ['/landing/', '/'],
    ['/landing/index.html', '/'],
    ['/landing/?utm_source=migration-check', '/?utm_source=migration-check'],
    ['/index.html', '/'],
    ['/swap', '/swap/'],
    ['/swap/index.html', '/swap/'],
    ['/?route=migration-check&ref=legacy', '/swap/?route=migration-check&ref=legacy'],
    ['/index.html?route=migration-check', '/swap/?route=migration-check'],
    ['/swap?route=migration-check', '/swap/?route=migration-check'],
]
async function request(path, userAgent, method = 'GET') {
    return fetch(origin + path, {
        method, redirect: 'manual', headers: { 'user-agent': userAgent },
        signal: AbortSignal.timeout(15000),
    })
}

for (const userAgent of ['Mozilla/5.0', 'Google-InspectionTool']) {
    for (const path of pages) {
        const response = await request(path, userAgent)
        assert.equal(response.status, 200, userAgent + ' ' + path)
        assert(!/noindex/i.test(response.headers.get('x-robots-tag') || ''), path + ' X-Robots-Tag')
        const doc = new JSDOM(await response.text(), { url: origin + path }).window.document
        assert.equal(doc.querySelector('link[rel="canonical"]')?.href, canonicalOrigin + path)
        assert.equal(doc.querySelector('meta[property="og:url"]')?.content, canonicalOrigin + path)
        assert(!/noindex/i.test(doc.querySelector('meta[name="robots"]')?.content || ''))
        assert.equal(doc.querySelectorAll('h1').length, 1, path + ' H1')
        assert.equal(Boolean(doc.querySelector('#wallet-kit-root')), path === '/swap/')
        for (const anchor of doc.querySelectorAll('a[href]')) {
            if (/^(Open wallet|Swap|Trade)$/.test(anchor.textContent.trim())) {
                assert.equal(new URL(anchor.href).pathname, '/swap/', path + ' CTA')
            }
        }
        console.log('PASS ' + userAgent + ' ' + path)
    }
    for (const [from, to] of redirects) {
        for (const method of ['GET', 'HEAD']) {
            const response = await request(from, userAgent, method)
            assert.equal(response.status, 301, method + ' ' + from + ' permanent redirect')
            assert.equal(new URL(response.headers.get('location'), origin).href, origin + to)
            await response.body?.cancel()
        }
    }
    for (const path of ['/landing/migration-missing/', '/swap/migration-missing/', '/migration-missing/']) {
        const response = await request(path, userAgent)
        assert.equal(response.status, 404, path + ' must not return a 200 shell')
        await response.body?.cancel()
    }
}
const sitemapResponse = await request('/sitemap.xml', 'Mozilla/5.0')
assert.equal(sitemapResponse.status, 200)
const sitemap = new JSDOM(await sitemapResponse.text(), { contentType: 'application/xml' }).window.document
assert.deepEqual([...sitemap.querySelectorAll('loc')].map(n => n.textContent).sort(),
    pages.map(path => canonicalOrigin + path).sort())
const manifestResponse = await request('/site.webmanifest', 'Mozilla/5.0')
assert.equal(manifestResponse.status, 200)
const manifest = await manifestResponse.json()
assert.equal(manifest.start_url, '/swap/')
assert.equal(manifest.id, '/')
assert.equal(manifest.scope, '/')
console.log('Public route checks passed: pages, redirects, query retention, 404s, sitemap and manifest.')
console.log('User-Agent parity is not proof that actual Google IPs can access this origin.')
