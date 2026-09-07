// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pages = ['index.html', 'landing/wallet/index.html', 'landing/how-it-works/index.html',
    'landing/gas-assist/index.html', 'landing/faq/index.html', 'gas-assist/index.html']

describe('shared responsive guide header', () => {
    it.each(pages)('%s uses the same four-link navigation and separate app CTA', (page) => {
        const doc = new DOMParser().parseFromString(readFileSync(page, 'utf8'), 'text/html')
        const header = doc.querySelector('.guide-header')
        expect(header.querySelectorAll('.guide-nav a')).toHaveLength(4)
        expect(header.querySelector(':scope > .brand').getAttribute('href')).toBe('/')
        expect(header.querySelector(':scope > .button').getAttribute('href')).toBe('/swap/')
        expect(doc.querySelector('link[href$="guides.css"]')).not.toBeNull()
    })

    // Source-level guard for the exact regression; real layout is checked in
    // the browser at 320–1920px, including both sides of each breakpoint.
    it('gives the mobile navigation both header columns, not just the brand column', () => {
        const css = readFileSync('landing/guides.css', 'utf8')
        expect(css).toMatch(/\.guide-header \.guide-nav\s*\{[^}]*grid-column:\s*1 \/ -1;/)
        expect(css).toMatch(/\.guide-header \.guide-nav\s*\{[^}]*width:\s*100%;/)
        expect(css).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
        expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
        expect(css).not.toContain('flex-basis: 100%')
        expect(css).toMatch(/\.guide-nav a\s*\{[^}]*min-height:\s*44px;/)
    })
})
