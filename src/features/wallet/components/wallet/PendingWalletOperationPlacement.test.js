import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

async function source(relativePath) {
    return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

describe('pending wallet operation placement', () => {
    it('renders transaction progress on the main swap page instead of the wallet account dialog', async () => {
        const [swapPage, walletDialog] = await Promise.all([
            source('../../../swap/components/SwapPage.jsx'),
            source('./WalletAccountDialog.jsx'),
        ])

        expect(swapPage).toContain('PendingWalletOperation')
        expect(swapPage).toContain('operationStatus?.walletAddress')
        expect(walletDialog).not.toContain('PendingWalletOperation')
    })

    it('keeps the main-screen status surface dark with white text', async () => {
        const css = await source('./walletPendingOperation.css')

        expect(css).toContain('background: rgb(24 24 24 / 96%)')
        expect(css).toContain('color: #fff')
        expect(css).toContain('position: fixed')
    })
})
