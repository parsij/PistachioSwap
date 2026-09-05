import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('Send dialog integration boundaries', () => {
    it('passes every positive wallet holding into the cross-chain Send flow', () => {
        const accountDialog = source('./WalletAccountDialog.jsx')

        expect(accountDialog).toContain('assets={heldAssets}')
        expect(accountDialog).not.toContain('assets={heldAssets.filter(')
    })

    it('lifts only the Send token picker above nested wallet dialogs', () => {
        const selector = source('../../../tokens/components/TokenSelector.jsx')
        const styles = source('./sendAssetDialog.css')

        expect(selector).toContain('data-side={side}')
        expect(styles).toContain(".ps-token-selector-backdrop[data-side='send']")
        expect(styles).toMatch(/data-side='send'[\s\S]*z-index:\s*180/)
    })

    it('keeps the Send surface rounded, responsive, and motion-aware', () => {
        const styles = source('./sendAssetDialog.css')

        expect(styles).toContain('border-radius: 28px')
        expect(styles).toContain('@media (max-width: 640px)')
        expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
    })
})
