// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { rewritePublicGuideHtml } from '../web3/publicGuideRoutes.js'
import AppLayout from './AppLayout.jsx'

const guidePages = [
    'index.html',
    'landing/wallet/index.html',
    'landing/how-it-works/index.html',
    'landing/gas-assist/index.html',
    'gas-assist/index.html',
    'landing/faq/index.html',
]
const guides = ['/wallet/', '/gas-assist/', '/how-it-works/']
const swapFooterLinks = [
    ['/', 'About'],
    ['/wallet/', 'Pistachio Wallet'],
    ['/gas-assist/', 'Gas Assist'],
    ['/how-it-works/', 'How Pistachio Swap works'],
    ['/faq/', 'FAQ'],
    ['/legal/third-party/', 'Legal & third-party notices'],
]
const parse = (html) => new DOMParser().parseFromString(rewritePublicGuideHtml(html), 'text/html')
const read = (path) => readFileSync(path, 'utf8')

describe('discoverable product guides', () => {
    it.each(guidePages)('%s links to all three guides in published HTML', (path) => {
        const doc = parse(read(path))
        for (const href of guides) {
            expect(doc.querySelectorAll(`a[href="${href}"]`).length).toBeGreaterThan(0)
        }
    })

    it('keeps the swap footer links without the duplicated marketing copy', () => {
        const staticSwap = parse(read('swap/index.html'))
        const mountedSwap = parse(renderToStaticMarkup(
            <AppLayout header={null} overlays={null}>Swap interface</AppLayout>,
        ))

        for (const doc of [staticSwap, mountedSwap]) {
            const footer = doc.querySelector('.app-info-footer')
            expect(footer).not.toBeNull()
            expect(footer.querySelector('h1')).toBeNull()
            expect(footer.querySelector('p')).toBeNull()

            const links = [...footer.querySelectorAll('a')].map((anchor) => [
                anchor.getAttribute('href'),
                anchor.textContent.trim(),
            ])
            expect(links).toEqual(swapFooterLinks)
        }
    })

    it.each([
        ['wallet', '/wallet/'],
        ['how-it-works', '/how-it-works/'],
    ])('%s is a standalone, accessible static guide', (slug, canonicalPath) => {
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
        expect(crumb.itemListElement.at(-1).item).toBe(`https://pistachioswap.com${canonicalPath}`)
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
