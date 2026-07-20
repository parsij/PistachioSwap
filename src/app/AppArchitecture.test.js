import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('application composition boundaries', () => {
    it('keeps App.jsx below the composition-shell limit', () => {
        expect(source('../App.jsx').split('\n')).toHaveLength(25)
        expect(source('../App.jsx')).toContain('useSwapController')
        expect(source('../App.jsx')).toContain('<SwapPage')
    })

    it('does not replace App with an oversized controller or page component', () => {
        for (const path of [
            '../features/swap/hooks/useSwapController.js',
            '../features/swap/hooks/useSwapQuote.js',
            '../features/cross-chain/hooks/useCrossChainController.js',
            '../features/swap/components/SwapPage.jsx',
        ]) {
            expect(source(path).split('\n').length).toBeLessThanOrEqual(800)
        }
    })
})
