// @vitest-environment node

import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

describe('Pistachio Wallet responsive style contract', () => {
    it('keeps the wallet portal above app UI with bounded internal scrolling', async () => {
        const css = await readFile(new URL('./pistachioWallet.css', import.meta.url), 'utf8')
        expect(css).toContain('z-index: 1000')
        expect(css).toContain('z-index: 1001')
        expect(css).toContain('max-height: calc(100dvh - 48px)')
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
        expect(css).toContain('background: #17271f')
    })

    it('defines a calm full-screen lock state above the application', async () => {
        const css = await readFile(new URL('./pistachioWallet.css', import.meta.url), 'utf8')
        expect(css).toContain('.pistachio-session-lock-overlay')
        expect(css).toContain('background: rgb(0 0 0 / 76%)')
        expect(css).toContain('.pistachio-session-lock-dialog')
        expect(css).toContain('.pistachio-session-unlock-button')
        expect(css).toContain('.pistachio-session-disconnect-button')
        expect(css).toContain('.pistachio-session-disconnect-confirmation')
    })

    it('uses the Pistachio green primary accent instead of the old pink accent', async () => {
        const css = await readFile(new URL('./pistachioWallet.css', import.meta.url), 'utf8')
        expect(css).toContain('--pw-accent: #9bd887')
        expect(css).not.toContain('#ff37c4')
    })

    it('keeps the wallet surface free from gradients and override stacking', async () => {
        const css = await readFile(new URL('./pistachioWallet.css', import.meta.url), 'utf8')
        expect(css).not.toContain('gradient(')
        expect(css).not.toContain('!important')
    })
})
