import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('Send dialog integration boundaries', () => {
    it('passes every positive wallet holding into the cross-chain Send flow', () => {
        const accountDialog = source('./WalletAccountDialog.jsx')

        expect(accountDialog).toContain('assets={heldAssets}')
        expect(accountDialog).not.toContain('assets={heldAssets.filter(')
    })

    it('uses a dedicated Send picker inside the active wallet dialog', () => {
        const selector = source('../../../tokens/components/TokenSelector.jsx')
        const picker = source('./SendTokenPicker.jsx')
        const styles = source('./sendTokenPicker.css')

        expect(selector).toContain("props.side === 'send'")
        expect(selector).toContain("document.querySelector('.wallet-send-dialog')")
        expect(selector).toContain('<SendTokenPicker')
        expect(picker).toContain('useTokenSelectorState')
        expect(picker).toContain('<ChainSelector')
        expect(picker).toContain("useState('all')")
        expect(picker).toContain("useState('')")
        expect(picker).toContain('sendTokenMatchesSearch(token, normalizedSearch)')
        expect(picker).toContain('send-token-picker-scroll')
        expect(picker).toContain('Search tokens')
        expect(styles).toContain(':has(.send-token-picker-layer)')
        expect(styles).toContain('overflow-y: auto')
    })

    it('keeps chain selection local instead of resetting the parent Send picker', () => {
        const picker = source('./SendTokenPicker.jsx')

        expect(picker).toContain('setSelectorChainId')
        expect(picker).toContain("value === 'all' ? 'all' : Number(value)")
        expect(picker).not.toContain('onChainChange(value')
        expect(picker).toContain('event.stopPropagation()')
    })

    it('keeps the Send surface rounded, responsive, and motion-aware', () => {
        const styles = source('./sendAssetDialog.css')
        const pickerStyles = source('./sendTokenPicker.css')

        expect(styles).toContain('border-radius: 28px')
        expect(styles).toContain('@media (max-width: 640px)')
        expect(pickerStyles).toContain('@media (max-width: 640px)')
        expect(pickerStyles).toContain('@media (prefers-reduced-motion: reduce)')
    })
})
