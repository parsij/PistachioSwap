import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * These rules are invisible on a desktop browser and in jsdom, which is exactly
 * why they rot. Each one below was measured failing in a mobile viewport before
 * it was added, so the assertion records the defect rather than the styling.
 */
function css(path) {
    return readFileSync(resolve(path), 'utf8')
}

function coarseBlocks(source) {
    // Top-level `@media (pointer: coarse)` blocks, including narrow-viewport fallbacks.
    return [...source.matchAll(/@media\s*\(pointer:\s*coarse\)(?:,\s*\(max-width:\s*520px\))?\s*\{/g)]
        .map((match) => {
            let depth = 1
            let index = match.index + match[0].length
            const start = index
            while (index < source.length && depth > 0) {
                if (source[index] === '{') depth += 1
                if (source[index] === '}') depth -= 1
                index += 1
            }
            return source.slice(start, index - 1)
        })
        .join('\n')
}

describe('mobile touch targets', () => {
    it('raises the slippage input to 16px on touch pointers', () => {
        // Below 16px, iOS Safari zooms the page on focus and does not zoom back.
        const coarse = coarseBlocks(
            css('src/features/settings/components/SwapSettingsPopover.css'),
        )
        expect(coarse).toMatch(/font-size:\s*16px/)
    })

    it('extends the fixed-height panel controls to a 44px hit area', () => {
        // The controls measure 14–36px tall and are absolutely positioned inside
        // panels of fixed height, so the hit area grows instead of the box.
        const source = css('src/index.css')
        expect(source).toMatch(/@media\s*\(pointer:\s*coarse\),\s*\(max-width:\s*520px\)/)
        const coarse = coarseBlocks(source)
        for (const control of [
            '.sell-fiat-value::after',
            '.buy-fiat-value::after',
            '.sell-balance::after',
            '.settings-button::after',
            '.swap-tab::after',
        ]) {
            expect(coarse).toContain(control)
        }
        expect(coarse).toMatch(/width:\s*max\(100%,\s*44px\)/)
        expect(coarse).toMatch(/height:\s*max\(100%,\s*44px\)/)
    })

    it('leaves pointer-precise devices alone', () => {
        // The expansion must not apply to a mouse, which can already hit 14px.
        const source = css('src/index.css')
        const outsideCoarse = source.replace(
            /@media\s*\(pointer:\s*coarse\),\s*\(max-width:\s*520px\)\s*\{[\s\S]*?\n\}/g,
            '',
        )
        expect(outsideCoarse).not.toContain('.sell-fiat-value::after')
    })

    it('keeps the token sheet clear of the home indicator', () => {
        // The sheet is anchored to the bottom of the viewport on a phone.
        const source = css('src/features/tokens/components/TokenSelector.css')
        expect(source).toMatch(
            /\.ps-token-selector-scroll\s*\{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom\)/,
        )
    })

    it('gives the token sheet controls a reachable size', () => {
        const coarse = coarseBlocks(
            css('src/features/tokens/components/TokenSelector.css'),
        )
        expect(coarse).toMatch(
            /\.ps-token-selector-close\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/,
        )
        // The 49px search row only accepted taps on its 26px input.
        expect(coarse).toMatch(
            /\.ps-token-search input\s*\{[^}]*align-self:\s*stretch/,
        )
    })

    it('pads the overview page footer links for a fingertip', () => {
        const coarse = coarseBlocks(css('landing/landing.css'))
        expect(coarse).toContain('.footer-links a')
        expect(coarse).toMatch(/padding-block:\s*12px/)
    })
})
