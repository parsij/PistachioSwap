// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AppLayout from './AppLayout.jsx'

const pages = [
    'index.html',
    'swap/index.html',
    'landing/wallet/index.html',
    'landing/how-it-works/index.html',
    'landing/gas-assist/index.html',
    'gas-assist/index.html',
    'landing/faq/index.html',
]
const guides = ['/landing/wallet/', '/landing/gas-assist/', '/landing/how-it-works/']
const parse = (html) => new DOMParser().parseFromString(html, 'text/html')
const read = (path) => readFileSync(path, 'utf8')

describe('discoverable product guides', () => {
    it.each(pages)('%s links to all three guides in real HTML', (path) => {
        const doc = parse(read(path))
        for (const href of guides) {
            expect(doc.querySelectorAll(`a[href="${href}"]`).length).toBeGreaterThan(0)
        }
    })

    it('keeps identical visible guide content before and after the app mounts', () => {
        const staticFooter = parse(read('swap/index.html')).querySelector('.app-info-footer')
        const appFooter = parse(renderToStaticMarkup(
            <AppLayout header={null} overlays={null}>Swap interface</AppLayout>,
        )).querySelector('.app-info-footer')
        const text = (element) => [...element.querySelectorAll('h1, p, a')]
            .map((node) => node.textContent.replace(/\s+/g, ' ').trim())
        expect(text(appFooter)).toEqual(text(staticFooter))
        expect([...appFooter.querySelectorAll('a')].map((a) => a.getAttribute('href')))
            .toEqual([...staticFooter.querySelectorAll('a')].map((a) => a.getAttribute('href')))
        expect(staticFooter.closest('[aria-hidden="true"], [hidden], noscript')).toBeNull()
    })

    it.each(['wallet', 'how-it-works'])('%s is a standalone, accessible static guide', (slug) => {
        const doc = parse(read(`landing/${slug}/index.html`))
        expect(doc.querySelectorAll('h1')).toHaveLength(1)
        expect(doc.querySelector('main').textContent.length).toBeGreaterThan(2500)
        expect(doc.querySelectorAll('script:not([type="application/ld+json"])')).toHaveLength(0)
        expect(doc.querySelector('[aria-label="Breadcrumb"] [aria-current="page"]')).not.toBeNull()
        for (const anchor of doc.querySelectorAll('a[href^="#"]')) {
            expect(doc.getElementById(anchor.hash.slice(1)), anchor.hash).not.toBeNull()
        }
        const graph = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent)['@graph']
        const crumb = graph.find((node) => node['@type'] === 'BreadcrumbList')
        expect(crumb.itemListElement.at(-1).item).toBe(`https://pistachioswap.com/landing/${slug}/`)
    })

    it('allows Google to render assets without changing the training-crawler policy', () => {
        const robots = read('public/robots.txt')
        const google = robots.split('User-agent: Googlebot\n')[1].split('User-agent:')[0]
        expect(google).toContain('Allow: /assets/')
        expect(google).toContain('Allow: /networkIcons/')
        expect(google).not.toContain('Disallow: /assets/')
        expect(robots).toMatch(/User-agent: Google-Extended[\s\S]*Disallow: \/assets\/[\s\S]*Disallow: \//)
    })

    it('keeps wallet limitations and Gas Assist fees visible', () => {
        const wallet = parse(read('landing/wallet/index.html')).body.textContent
        expect(wallet).toContain('A synced passkey is not a wallet backup')
        expect(wallet).toContain('has not been independently audited')
        expect(wallet).toContain('it is not a free transaction')
        expect(wallet).toContain('Not every passkey provider supports it')
    })
})
