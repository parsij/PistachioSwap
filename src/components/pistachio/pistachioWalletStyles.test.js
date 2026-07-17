// @vitest-environment node

import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

describe('Pistachio Wallet responsive style contract', () => {
    it('keeps the wallet portal above app UI with bounded internal scrolling', async () => {
        const css = await readFile(new URL('./pistachioWallet.css', import.meta.url), 'utf8')
        expect(css).toContain('z-index: 1000')
        expect(css).toContain('z-index: 1001')
        expect(css).toContain('max-height: min(820px, calc(100dvh - 28px))')
        expect(css).toContain('overflow-y: auto')
        expect(css).toContain('overscroll-behavior: contain')
    })

    it('defines narrow mobile, safe-area, focus, and reduced-motion behavior', async () => {
        const css = await readFile(new URL('./pistachioWallet.css', import.meta.url), 'utf8')
        expect(css).toContain('@media (max-width: 640px)')
        expect(css).toContain('@media (max-width: 360px)')
        expect(css).toContain('env(safe-area-inset-bottom)')
        expect(css).toContain(':focus-visible')
        expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    })

    it('shows a green confirmation state for correctly entered recovery words', async () => {
        const css = await readFile(new URL('./pistachioWallet.css', import.meta.url), 'utf8')
        expect(css).toContain('.pistachio-word-confirmation input.is-correct')
        expect(css).toContain('border-color: #48d98b')
        expect(css).toContain('background: #172a21')
    })

    it('defines a full-screen blurred lock state above the application', async () => {
        const css = await readFile(new URL('./pistachioWallet.css', import.meta.url), 'utf8')
        expect(css).toContain('.pistachio-session-lock-overlay')
        expect(css).toContain('backdrop-filter: blur(12px)')
        expect(css).toContain('.pistachio-session-lock-dialog')
        expect(css).toContain('.pistachio-session-unlock-button')
        expect(css).toContain('.pistachio-session-disconnect-button')
        expect(css).toContain('.pistachio-session-disconnect-confirmation')
    })

    it('uses the Pistachio green primary accent instead of the old pink accent', async () => {
        const css = await readFile(new URL('./pistachioWallet.css', import.meta.url), 'utf8')
        expect(css).toContain('background: #8ac27c')
        expect(css).not.toContain('#ff37c4')
    })
})
