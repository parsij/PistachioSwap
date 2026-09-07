import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { isCrawlerUserAgent } from '../../landing/coin-mode.js'

describe('landing coin crawler mode', () => {
    it('recognizes Google inspection and common search crawlers', () => {
        expect(isCrawlerUserAgent('Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)')).toBe(true)
        expect(isCrawlerUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true)
        expect(isCrawlerUserAgent('Mozilla/5.0 (compatible; bingbot/2.0)')).toBe(true)
    })

    it('does not classify ordinary browsers as crawlers', () => {
        expect(isCrawlerUserAgent('Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36')).toBe(false)
        expect(isCrawlerUserAgent('Mozilla/5.0 Version/18.0 Mobile/15E148 Safari/604.1')).toBe(false)
    })

    it('keeps the crawler coin path static and lightweight', () => {
        const source = readFileSync(resolve('landing/coin-static.js'), 'utf8')
        expect(source).toContain('coin-poster.webp')
        expect(source).not.toMatch(/createElement\(['"]video['"]\)/)
        expect(source).not.toContain('coin-live.js')
        expect(source).not.toContain('coin-low.mp4')
        expect(source).not.toContain('coin-low-alpha.webm')
    })
})
