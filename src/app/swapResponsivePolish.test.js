import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function source(path) {
    return readFileSync(resolve(path), 'utf8')
}

describe('swap responsive polish', () => {
    it('uses compact vertical spacing at the same practical tablet and phone boundaries', () => {
        const css = source('src/index.css')

        expect(css).toMatch(
            /@media\s*\(max-width:\s*768px\)[\s\S]*?\.swap-root\s*\{[^}]*margin-top:\s*48px/,
        )
        expect(css).toMatch(
            /@media\s*\(max-width:\s*640px\)[\s\S]*?\.swap-root\s*\{[^}]*width:\s*calc\(100vw - 16px\)[^}]*margin-top:\s*20px/,
        )
    })

    it('keeps hover-only polish away from touch-primary input', () => {
        const css = source('src/index.css')

        expect(css).toMatch(
            /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/,
        )
        expect(css).toContain('.selected-token-button:hover')
        expect(css).toContain('.primary-action-ready:hover')
    })

    it('honors reduced motion for the initial swap entrance', () => {
        const page = source('src/features/swap/components/SwapPage.jsx')

        expect(page).toContain('useReducedMotion')
        expect(page).toContain('<motion.section')
        expect(page).toContain('initial={reducedMotion ? false')
    })

    it('animates card reflow without changing swap state ownership', () => {
        const card = source('src/features/swap/components/SwapCard.jsx')

        expect(card).toContain('className="swap-card-stack"')
        expect(card).toContain('layout')
        expect(card).toContain('useReducedMotion')
    })
})
