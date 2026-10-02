import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function css(path) {
    return readFileSync(resolve(path), 'utf8')
}

describe('adaptive exchange surfaces', () => {
    it('uses the dedicated Uniswap-size global search modal and mobile sheet', () => {
        const source = css('src/features/tokens/components/GlobalSearchModal.css')

        expect(source).toMatch(
            /\.global-search-modal\s*\{[\s\S]*width:\s*640px[\s\S]*max-height:\s*520px/,
        )
        expect(source).toMatch(
            /@media \(max-width:\s*1400px\)[\s\S]*\.global-search-modal\s*\{[\s\S]*width:\s*540px/,
        )
        expect(source).toMatch(
            /\.global-search-modal\s*\{[\s\S]*height:\s*85dvh[\s\S]*border-radius:\s*24px 24px 0 0/,
        )
    })

    it('keeps search readable instead of blurring the application behind it', () => {
        const source = css('src/features/tokens/components/GlobalSearchModal.css')

        expect(source).toMatch(
            /\.global-search-backdrop\s*\{[\s\S]*background:\s*rgb\(0 0 0 \/ 46%\)/,
        )
        expect(source).not.toMatch(
            /\.global-search-backdrop\s*\{[^}]*backdrop-filter:\s*blur/,
        )
        expect(source).not.toContain('.global-search-footer')
    })

    it('uses Uniswap desktop account-drawer geometry instead of a centered wallet modal', () => {
        const source = css('src/features/wallet/components/wallet/walletAccount.css')

        expect(source).toMatch(
            /\.wallet-account-dialog\.uni-wallet-dialog\s*\{[\s\S]*right:\s*12px[\s\S]*width:\s*min\(368px/,
        )
        expect(source).toMatch(
            /\.wallet-account-dialog\.uni-wallet-dialog\s*\{[\s\S]*top:\s*var\(--size-header-height\)/,
        )
        expect(source).toMatch(
            /\.wallet-account-dialog\.uni-wallet-dialog\s*\{[\s\S]*transform:\s*none/,
        )
    })

    it('keeps the portfolio at the same 1200/360 geometry as the reference layout', () => {
        const source = css('src/features/portfolio/components/PortfolioPage.css')

        expect(source).toMatch(
            /\.uni-portfolio-page\s*\{[\s\S]*width:\s*min\(1200px/,
        )
        expect(source).toMatch(
            /\.uni-portfolio-right-rail\s*\{[\s\S]*width:\s*360px[\s\S]*padding-top:\s*92px/,
        )
        expect(source).toMatch(
            /\.uni-portfolio-hero\s*\{[\s\S]*gap:\s*40px/,
        )
        expect(source).toMatch(
            /\.uni-portfolio-action-grid\s*\{[\s\S]*width:\s*360px[\s\S]*gap:\s*12px/,
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
