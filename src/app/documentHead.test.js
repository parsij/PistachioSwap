import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * Search engines and link unfurlers only ever see these static files: the swap
 * interface itself renders after the bundle executes. A silent regression here
 * is invisible in the running app, so the contract is pinned.
 */
const SITE = 'https://pistachioswap.com'

function read(path) {
    return readFileSync(resolve(path), 'utf8')
}

function decode(value) {
    return String(value)
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
}

function oneLine(value) {
    return decode(value).replace(/\s+/g, ' ').trim()
}

function metaContent(html, attribute, name) {
    const pattern = new RegExp(
        `<meta\\s+${attribute}="${name}"[\\s\\S]*?content="([^"]+)"`,
    )
    return oneLine(pattern.exec(html)?.[1] ?? '')
}

function pageTitle(html) {
    return oneLine(/<title>([^<]+)<\/title>/.exec(html)?.[1] ?? '')
}

function pageH1s(html) {
    const body = html.replace(/<script[\s\S]*?<\/script>/g, '')
    return [...body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => (
        oneLine(match[1].replace(/<[^>]+>/g, ' '))
    ))
}

function structuredData(html) {
    const blocks = [...html.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    )].map((match) => JSON.parse(match[1]))
    return blocks.flatMap((block) => block['@graph'] ?? [block])
}

describe.each([
    ['index.html', `${SITE}/`],
    ['landing/index.html', `${SITE}/landing/`],
    ['landing/faq/index.html', `${SITE}/landing/faq/`],
    ['landing/gas-assist/index.html', `${SITE}/landing/gas-assist/`],
])('%s document head', (path, canonical) => {
    const html = read(path)

    it('carries a title and a meta description', () => {
        const title = pageTitle(html)
        expect(title.length).toBeGreaterThan(10)
        expect(title.length).toBeLessThanOrEqual(70)

        const description = metaContent(html, 'name', 'description')
        expect(description.length).toBeGreaterThan(50)
        expect(description.length).toBeLessThanOrEqual(160)
    })

    it('keeps one H1 that matches the title and description', () => {
        const title = pageTitle(html)
        const description = metaContent(html, 'name', 'description')
        const headings = pageH1s(html)

        expect(headings).toHaveLength(1)
        const heading = headings[0]
        expect(heading.length).toBeGreaterThan(8)
        expect(title.toLowerCase().startsWith(heading.toLowerCase())).toBe(true)
        expect(description.toLowerCase()).toContain(heading.toLowerCase())

        expect(metaContent(html, 'property', 'og:title')).toBe(title)
        expect(metaContent(html, 'property', 'og:description')).toBe(description)
        expect(metaContent(html, 'name', 'twitter:title')).toBe(title)
        expect(metaContent(html, 'name', 'twitter:description')).toBe(description)
    })

    it('declares its own canonical URL', () => {
        expect(html).toContain(`<link rel="canonical" href="${canonical}" />`)
    })

    it('is indexable', () => {
        const robots = /<meta\s+name="robots"\s+content="([^"]+)"/
            .exec(html)?.[1] ?? ''
        expect(robots).toContain('index')
        expect(robots).not.toContain('noindex')
    })

    it('unfurls with an image that exists in the published tree', () => {
        for (const property of ['og:title', 'og:description', 'og:url', 'og:image']) {
            expect(html).toContain(`property="${property}"`)
        }
        expect(html).toContain('name="twitter:card"')

        const image = /<meta\s+property="og:image"\s+content="([^"]+)"/
            .exec(html)?.[1] ?? ''
        expect(image.startsWith(SITE)).toBe(true)
        // A 404 unfurl image is worse than none, so the file must be shipped.
        expect(() => read(`public${image.slice(SITE.length)}`)).not.toThrow()
    })

    it('embeds valid structured data naming this site', () => {
        const nodes = structuredData(html)
        expect(nodes.length).toBeGreaterThan(0)
        for (const node of nodes) expect(typeof node['@type']).toBe('string')
        expect(nodes.some((node) => node['@type'] === 'Organization')).toBe(true)
    })
})

describe('crawler-facing static files', () => {
    it('points robots.txt at the sitemap and keeps licence texts out of the index', () => {
        const robots = read('public/robots.txt')
        expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`)
        expect(robots).toContain('Disallow: /legal/third-party/')
        expect(robots).toMatch(/User-agent:\s*Googlebot[\s\S]*Allow:\s*\/landing/)
        expect(robots).toMatch(/User-agent:\s*Google-Extended[\s\S]*Disallow:\s*\//)
        expect(robots).toMatch(/User-agent:\s*ChatGPT-User[\s\S]*Allow:\s*\/landing/)
    })

    it('lists every indexable page in the sitemap', () => {
        const sitemap = read('public/sitemap.xml')
        for (const location of [
            `${SITE}/`,
            `${SITE}/landing/`,
            `${SITE}/gas-assist/`,
            `${SITE}/landing/faq/`,
            `${SITE}/landing/gas-assist/`,
        ]) {
            expect(sitemap).toContain(`<loc>${location}</loc>`)
        }
    })

    it('ships a parseable web manifest', () => {
        const manifest = JSON.parse(read('public/site.webmanifest'))
        expect(manifest.name).toBe('Pistachio Swap')
        expect(manifest.start_url).toBe('/')
        expect(manifest.icons.length).toBeGreaterThan(0)
        for (const icon of manifest.icons) {
            expect(() => read(`public${icon.src}`)).not.toThrow()
        }
    })
})

describe('landing page', () => {
    const html = read('landing/index.html')

    it('puts the terms people search for into its headings', () => {
        const h1 = /<h1>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? ''
        const headings = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)]
            .map((match) => match[1].replace(/<[^>]+>/g, ' '))
            .join(' ')
            .toLowerCase()

        expect(html.match(/<h1[\s\S]*?<\/h1>/g)?.length ?? 0).toBe(1)
        expect(h1.toLowerCase()).toContain('without bnb')
        expect(headings).toContain('gas assisted swaps')
        expect(headings).toContain('self-custodial')
    })

    it('stays short enough for someone to actually read it', () => {
        const words = html
            .replace(/<script[\s\S]*?<\/script>/g, '')
            .replace(/<[^>]+>/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
        expect(words.length).toBeLessThan(900)
    })

    it('renders its content without the application bundle', () => {
        expect(html).not.toContain('/src/main.jsx')
        const text = html
            .replace(/<script[\s\S]*?<\/script>/g, '')
            .replace(/<[^>]+>/g, ' ')
        expect(text.replace(/\s+/g, ' ').trim().length).toBeGreaterThan(2000)
    })

    it('states the pre-release status rather than burying it', () => {
        expect(html).toContain('has not been independently audited')
    })

    it('links to the wallet, FAQ, and Gas Assist pages', () => {
        expect(html).toContain('href="/"')
        expect(html).toContain('href="/landing/faq/"')
        expect(html).toContain('href="/landing/gas-assist/"')
        expect(html).toContain('href="/gas-assist/"')
    })

    it('shows network icons in a sticky auto-scrolling bar', () => {
        expect(html).toContain('class="network-ticker"')
        expect(html).toContain('class="site-nav"')
        expect(html).toContain('/networkIcons/bsc.webp')
        expect(html).toContain('BNB Smart Chain')
        expect(html).toContain('ticker.js')
        expect(html).toContain('type="module"')

        const css = read('landing/landing.css')
        expect(css).toMatch(/\.site-chrome\s*\{[^}]*position:\s*sticky/)
        expect(css).toContain('@keyframes network-ticker-scroll')
        expect(css).toContain('animation-play-state: paused')
        expect(css).toContain('cursor: grab')
        expect(css).toMatch(/\.site-nav\s*\{[^}]*background:\s*transparent/)
        expect(css).toContain('color: #f4f4f4')
    })
})

describe('FAQ page', () => {
    const html = read('landing/faq/index.html')

    it('answers questions in markup, not only in structured data', () => {
        const faq = structuredData(html)
            .find((node) => node['@type'] === 'FAQPage')
        expect(faq.mainEntity.length).toBeGreaterThanOrEqual(5)

        for (const question of faq.mainEntity) {
            expect(html).toContain(question.name)
        }
    })

    it('keeps a single H1 that matches the search topic', () => {
        const h1 = /<h1>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? ''
        expect(html.match(/<h1[\s\S]*?<\/h1>/g)?.length ?? 0).toBe(1)
        expect(h1.toLowerCase()).toContain('faq')
        expect(h1.toLowerCase()).toContain('without bnb')
    })
})

describe('dedicated Gas Assist guide', () => {
    const html = read('gas-assist/index.html')
    const canonical = `${SITE}/gas-assist/`

    it('carries a title and a meta description', () => {
        const title = /<title>([^<]+)<\/title>/.exec(html)?.[1] ?? ''
        expect(title.length).toBeGreaterThan(10)
        expect(title.length).toBeLessThanOrEqual(70)

        const description = /<meta\s+name="description"[\s\S]*?content="([^"]+)"/
            .exec(html)?.[1] ?? ''
        expect(description.length).toBeGreaterThan(50)
        expect(description.length).toBeLessThanOrEqual(320)
    })

    it('declares its own canonical URL', () => {
        expect(html).toContain(`<link rel="canonical" href="${canonical}" />`)
    })

    it('is indexable', () => {
        const robots = /<meta\s+name="robots"\s+content="([^"]+)"/
            .exec(html)?.[1] ?? ''
        expect(robots).toContain('index')
        expect(robots).not.toContain('noindex')
    })

    it('unfurls with an image that exists in the published tree', () => {
        for (const property of ['og:title', 'og:description', 'og:url', 'og:image']) {
            expect(html).toContain(`property="${property}"`)
        }
        expect(html).toContain('name="twitter:card"')

        const image = /<meta\s+property="og:image"\s+content="([^"]+)"/
            .exec(html)?.[1] ?? ''
        expect(image.startsWith(SITE)).toBe(true)
        expect(() => read(`public${image.slice(SITE.length)}`)).not.toThrow()
    })

    it('embeds valid structured data naming this site', () => {
        const nodes = structuredData(html)
        expect(nodes.length).toBeGreaterThan(0)
        for (const node of nodes) expect(typeof node['@type']).toBe('string')
        expect(nodes.some((node) => node['@type'] === 'Organization')).toBe(true)
    })

    it('stays a static HTML page', () => {
        expect(html).not.toContain('/src/main.jsx')
    })
})

describe('Gas Assist page', () => {
    const html = read('landing/gas-assist/index.html')

    it('explains the flow in HTML, not only in the wallet app', () => {
        expect(html).not.toContain('/src/main.jsx')
        expect(html).toContain('three-transaction package')
        expect(html).toContain('has not been independently audited')
    })

    it('keeps a single H1 about Gas Assist on BNB Chain', () => {
        const h1 = /<h1>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? ''
        expect(html.match(/<h1[\s\S]*?<\/h1>/g)?.length ?? 0).toBe(1)
        expect(h1.toLowerCase()).toContain('gas assist')
        expect(h1.toLowerCase()).toContain('bnb')
    })
})
