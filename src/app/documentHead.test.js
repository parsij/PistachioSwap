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

function structuredData(html) {
    const blocks = [...html.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    )].map((match) => JSON.parse(match[1]))
    return blocks.flatMap((block) => block['@graph'] ?? [block])
}

describe.each([
    ['index.html', `${SITE}/`],
    ['landing/index.html', `${SITE}/landing/`],
    ['gas-assist/index.html', `${SITE}/gas-assist/`],
])('%s document head', (path, canonical) => {
    const html = read(path)

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
    })

    it('lists every indexable page in the sitemap', () => {
        const sitemap = read('public/sitemap.xml')
        for (const location of [
            `${SITE}/`,
            `${SITE}/landing/`,
            `${SITE}/gas-assist/`,
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

    it('answers questions in markup, not only in structured data', () => {
        const faq = structuredData(html)
            .find((node) => node['@type'] === 'FAQPage')
        expect(faq.mainEntity.length).toBeGreaterThanOrEqual(5)

        // Every advertised answer must also be readable on the page itself.
        for (const question of faq.mainEntity) {
            expect(html).toContain(question.name)
        }
    })

    it('puts the terms people search for into its headings', () => {
        // A heading carries weight a paragraph does not, so the brand and the
        // feature people actually search for have to appear in one.
        const h1 = /<h1>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? ''
        const headings = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)]
            .map((match) => match[1].replace(/<[^>]+>/g, ' '))
            .join(' ')
            .toLowerCase()

        expect(h1.toLowerCase()).toContain('pistachio swap')
        expect(headings).toContain('gas assisted swaps')
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

    it('links back to the application', () => {
        expect(html).toContain('href="/"')
    })
})
