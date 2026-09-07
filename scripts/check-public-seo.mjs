import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'

// Run after the build. Check published files, not only Vite's source HTML.
const root = resolve('dist')
const origin = 'https://pistachioswap.com'
const pages = ['/', '/swap/', '/landing/wallet/', '/landing/how-it-works/',
    '/landing/gas-assist/', '/gas-assist/', '/landing/faq/']
const read = (path) => readFileSync(resolve(root, path.replace(/^\//, '')), 'utf8')
const sitemap = new JSDOM(read('sitemap.xml'), { contentType: 'application/xml' }).window.document
const locations = [...sitemap.querySelectorAll('loc')].map((loc) => loc.textContent)
assert.deepEqual([...locations].sort(), pages.map((path) => origin + path).sort())
assert.equal(new Set(locations).size, locations.length)
const titles = new Set()
const descriptions = new Set()
const robots = read('robots.txt').split('User-agent: Googlebot\n')[1]?.split('User-agent:')[0]
assert(robots?.includes('Allow: /assets/'), 'Google must be allowed to render CSS and JavaScript')
assert(!robots.includes('Disallow: /assets/'))
for (const path of pages) {
    const html = read(path + 'index.html')
    const doc = new JSDOM(html, { url: origin + path }).window.document
    const canonical = doc.querySelector('link[rel="canonical"]')?.href
    assert.equal(canonical, origin + path, path + ' canonical')
    assert.equal(doc.querySelector('meta[property="og:url"]')?.content, canonical)
    assert(doc.querySelector('meta[name="robots"]')?.content.includes('index'))
    assert(!doc.querySelector('meta[name="robots"]')?.content.includes('noindex'))
    assert.equal(doc.querySelectorAll('h1').length, 1, path + ' H1')
    const description = doc.querySelector('meta[name="description"]')?.content
    assert(doc.title && description)
    assert(!titles.has(doc.title), 'Duplicate title: ' + path)
    assert(!descriptions.has(description), 'Duplicate description: ' + path)
    titles.add(doc.title)
    descriptions.add(description)
    for (const block of doc.querySelectorAll('script[type="application/ld+json"]')) {
        const data = JSON.parse(block.textContent)
        assert.equal(data['@context'], 'https://schema.org')
        assert(data['@graph'].some((node) => node.url === canonical))
    }
    for (const guide of ['/landing/wallet/', '/landing/gas-assist/', '/landing/how-it-works/']) {
        assert(doc.querySelector(`a[href="${guide}"]`), path + ' must link to ' + guide)
    }
    for (const node of doc.querySelectorAll('a[href], link[rel="stylesheet"], img[src], script[src]')) {
        const url = new URL(node.getAttribute('href') || node.getAttribute('src'), canonical)
        if (url.origin !== origin) continue
        const target = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname
        assert(existsSync(resolve(root, decodeURIComponent(target).replace(/^\//, ''))),
            `${path}: broken local resource ${url.pathname}`)
        if (url.hash && url.pathname === path) {
            assert(doc.getElementById(decodeURIComponent(url.hash.slice(1))), path + ' missing anchor ' + url.hash)
        }
    }
    if (path !== '/swap/') assert(!doc.querySelector('#wallet-kit-root'), path + ' must be static')
    else assert(doc.querySelector('#wallet-kit-root'), 'The wallet must mount at /swap/')
    for (const anchor of doc.querySelectorAll('a[href]')) {
        assert.notEqual(new URL(anchor.href).pathname, '/landing/', path + ' links to a retired URL')
        if (/^(Open wallet|Swap|Trade)$/.test(anchor.textContent.trim())) {
            assert.equal(new URL(anchor.href).pathname, '/swap/', path + ' app CTA')
        }
    }
    console.log('PASS ' + path)
}
console.log('SEO build checks passed: 7 canonical pages, metadata, schema, sitemap, resources, and guide links.')
