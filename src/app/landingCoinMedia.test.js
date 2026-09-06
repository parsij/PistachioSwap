import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const coinMedia = () => readFileSync(new URL('../../landing/coin-media.js', import.meta.url), 'utf8')

describe('landing coin media', () => {
    it('loads a lightweight video directly instead of downloading the large GIF first', () => {
        const source = coinMedia()

        expect(source).not.toContain('coin-fallback.gif')
        expect(source).not.toContain('coin-medium.mp4')
        expect(source).not.toContain('coin-high.mp4')
        expect(source).not.toContain('coin-ultra.mp4')
        expect(source).toContain("video.dataset.quality = 'low'")
        expect(source).toContain('video.src = MEDIA.low')
        expect(source).toContain("video.preload = 'auto'")
        expect(source).toContain('startVideo(video, poster, frame)')
    })

    it('blends the baked media background into the landing-page background', () => {
        const source = coinMedia()

        expect(source).toContain('background: var(--bg);')
        expect(source).toContain('mix-blend-mode: lighten;')
    })
})
