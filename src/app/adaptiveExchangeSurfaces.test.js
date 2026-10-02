import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function css(path) {
    return readFileSync(resolve(path), 'utf8')
}

describe('adaptive exchange surfaces', () => {
    it('uses a wider desktop global-search modal and mobile sheet height', () => {
        const source = css('src/features/tokens/components/TokenSelectorPolish.css')
        expect(source).toMatch(
            /data-mode='global-search'[\s\S]*width:\s*min\(640px/,
        )
        expect(source).toMatch(
            /data-mode='global-search'[\s\S]*height:\s*min\(85dvh/,
        )
    })

    it('turns review and Gas Assist dialogs into compact bottom sheets', () => {
        for (const [path, selector] of [
            ['src/index.css', '.swap-review-dialog'],
            ['src/features/cross-chain/components/crossChain.css', '.cross-chain-review-dialog'],
            ['src/features/gas-assist/components/gasAssist.css', '.gas-assist-dialog'],
        ]) {
            const source = css(path)
            expect(source).toContain('@media (max-width: 720px), (max-width: 900px) and (max-height: 760px)')
            expect(source).toContain(selector)
            expect(source).toMatch(/bottom:\s*0/)
            expect(source).toMatch(/border-radius:\s*24px 24px 0 0/)
        }
    })
})
