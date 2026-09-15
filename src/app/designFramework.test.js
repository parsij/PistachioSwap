import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { rewritePublicGuideHtml } from '../web3/publicGuideRoutes.js'

const read = (path) => readFileSync(resolve(path), 'utf8')

describe('UI design framework', () => {
    it('loads the static design entry only on marketing/guide HTML', () => {
        const marketing = rewritePublicGuideHtml(`<!doctype html><html><head><link rel="stylesheet" href="/landing/landing.css" /></head><body></body></html>`)
        const swap = rewritePublicGuideHtml(`<!doctype html><html><head></head><body><div id="root"></div></body></html>`)

        expect(marketing).toContain('/landing/design-entry.js')
        expect(marketing.match(/\/landing\/design-entry\.js/g)).toHaveLength(1)
        expect(swap).not.toContain('/landing/design-entry.js')
    })

    it('keeps Ubuntu as the single rendered UI family', () => {
        const app = read('src/designFramework.css')
        const landing = read('landing/designFramework.css')
        const appEntry = read('src/main.jsx')
        const landingEntry = read('landing/design-entry.js')

        expect(app).toContain('--ux-font-family: Ubuntu')
        expect(landing).toContain('--ux-font-family: Ubuntu')
        expect(appEntry).toContain("@fontsource/ubuntu/latin-400.css")
        expect(landingEntry).toContain("@fontsource/ubuntu/latin-400.css")
    })

    it('enforces the requested heading metrics and compact type scales', () => {
        const app = read('src/designFramework.css')
        const appScale = read('src/designTypeScale.css')
        const landingScale = read('landing/designTypeScale.css')

        expect(app).toContain('letter-spacing: -0.025em')
        expect(app).toContain('line-height: 1.15')
        expect(appScale).toContain('var(--ux-type-xl) !important')
        expect(landingScale).toContain('var(--ux-type-display) !important')
    })

    it('defines hover, pressed, disabled, focus, invalid, warning and busy feedback', () => {
        const css = read('src/designFramework.css')

        expect(css).toContain(':hover')
        expect(css).toContain(':active')
        expect(css).toContain(':disabled')
        expect(css).toContain(':focus-visible')
        expect(css).toContain("[aria-invalid='true']")
        expect(css).toContain("[data-warning='true']")
        expect(css).toContain("[aria-busy='true']::before")
    })

    it('keeps action, danger, warning and success colors semantically distinct', () => {
        const css = read('src/designFramework.css')

        expect(css).toContain('--ux-action: #6b9cff')
        expect(css).toContain('--ux-danger: #ff6b78')
        expect(css).toContain('--ux-warning: #f2c14e')
        expect(css).toContain('--ux-success: #8ac27c')
    })
})
