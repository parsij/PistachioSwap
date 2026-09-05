import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ticker = () => readFileSync(new URL('../../landing/ticker.js', import.meta.url), 'utf8')

describe('landing FAQ motion', () => {
    it('animates native details in both directions without closing content early', () => {
        const source = ticker()

        expect(source).toContain("document.querySelectorAll('.faq details').forEach(setupFaqDetails)")
        expect(source).toContain('event.preventDefault()')
        expect(source).toContain("typeof details.animate !== 'function'")
        expect(source).toContain('animation?.cancel()')
        expect(source).toContain('details.open = nextOpen')
        expect(source).toContain("easing: 'cubic-bezier(0.22, 1, 0.36, 1)'")
        expect(source).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')")
    })
})
