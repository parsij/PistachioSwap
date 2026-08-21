import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const GUEST_FILES = [
    'src/main.jsx',
    'src/App.jsx',
    'src/features/swap/hooks/useSwapController.js',
    'src/features/wallet/hooks/useWalletState.js',
    'src/features/wallet/components/wallet/WalletAccountButton.jsx',
    'src/features/tokens/hooks/useNativeBalance.js',
    'src/features/approvals/hooks/useSwapApproval.js',
    'src/features/gas-assist/hooks/usePrepaidSponsorship.js',
    'src/features/gas-assist/hooks/useZeroXGaslessSwap.js',
    'src/features/swap/hooks/useSameChainReceiptLifecycle.js',
]

describe('wallet JavaScript stays off first visit and off crawler HTML', () => {
    it('does not statically import AppKit or Wagmi in the guest graph', () => {
        for (const path of GUEST_FILES) {
            const source = readFileSync(path, 'utf8')
            expect(source, path).not.toMatch(/from ['"]wagmi['"]/)
            expect(source, path).not.toMatch(/from ['"]@reown\/appkit/)
        }

        const main = readFileSync('src/main.jsx', 'utf8')
        expect(main).toContain('registerWalletRuntimeLoader')
        expect(main).toContain("import('./web3/AppKitProvider.jsx')")
        expect(main).toContain("import('./web3/LiveWalletBindings.jsx')")
        expect(main).toContain("import('./App.jsx')")
    })

    it('keeps landing pages free of the wallet entry script', () => {
        for (const path of [
            'landing/index.html',
            'landing/faq/index.html',
            'landing/gas-assist/index.html',
        ]) {
            const html = readFileSync(path, 'utf8')
            expect(html).not.toContain('/src/main.jsx')
            expect(html).not.toContain('wallet-kit-root')
        }
    })

    it('does not preload AppKit or Wagmi in the production app HTML', () => {
        if (!existsSync('dist/index.html')) return
        const html = readFileSync('dist/index.html', 'utf8')
        expect(html).not.toMatch(/appkit/i)
        expect(html).not.toMatch(/wagmi/i)
        expect(html).not.toContain('LiveWalletBindings')
        expect(html).not.toContain('AppKitProvider')
        expect(readFileSync('dist/landing/index.html', 'utf8')).not.toMatch(/\/assets\/main-/)
    })
})
