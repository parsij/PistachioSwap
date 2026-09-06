import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const coinMedia = () => readFileSync(new URL('../../landing/coin-media.js', import.meta.url), 'utf8')
const liveCoin = () => readFileSync(new URL('../../landing/coin-live.js', import.meta.url), 'utf8')
const landingStyles = () => readFileSync(new URL('../../landing/landing.css', import.meta.url), 'utf8')
const gasAssistPage = () => readFileSync(new URL('../../landing/gas-assist/index.html', import.meta.url), 'utf8')

describe('landing coin media', () => {
    it('renders directly with Three.js without loading baked-background media', () => {
        const source = coinMedia()

        expect(source).not.toContain('coin-fallback.gif')
        expect(source).not.toContain('.mp4')
        expect(source).not.toContain('<video')
        expect(source).toContain("import('./coin-live.js')")
        expect(source).toContain("frame.dataset.mediaMode = 'three'")
    })

    it('uses a transparent Three.js canvas and pauses rendering offscreen', () => {
        const source = liveCoin()

        expect(source).toContain("import * as THREE from 'three'")
        expect(source).toContain('alpha: true')
        expect(source).toContain('renderer.setClearColor(0x000000, 0)')
        expect(source).toContain("new IntersectionObserver")
    })

    it('centers Gas Assist hero actions at the responsive breakpoint', () => {
        expect(gasAssistPage()).not.toContain('style="justify-content: flex-start"')
        expect(landingStyles()).toMatch(
            /@media \(max-width: 900px\)[\s\S]*?\.hero-with-coin \.hero-actions \{\s*justify-content: center;/,
        )
    })
})
