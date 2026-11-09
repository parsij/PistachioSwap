// @vitest-environment jsdom
import React, { useEffect, useState } from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
    view: 'trade',
    mounted: vi.fn(),
    unmounted: vi.fn(),
}))

vi.mock('./app/useAppView.js', () => ({
    useAppView: () => mocks.view,
}))
vi.mock('./features/swap/hooks/useSwapController.js', () => ({
    useSwapController: () => ({
        layoutStyle: {},
        header: { brand: { name: 'PistachioSwap' }, wallet: {}, search: {} },
        page: { tokenSelector: {}, card: { buyPanel: { token: { symbol: 'UNI' } } } },
    }),
}))
vi.mock('./app/AppHeader.jsx', () => ({
    default: () => <header data-testid="app-header">PistachioSwap</header>,
}))
vi.mock('./features/swap/components/SwapPage.jsx', () => ({
    default: () => <section data-testid="swap-view">Swap</section>,
}))
vi.mock('./features/portfolio/components/PortfolioPage.jsx', () => ({
    default: () => <section data-testid="portfolio-view">Portfolio</section>,
}))
vi.mock('./features/tokens/components/TokenDetailsPage.jsx', () => ({
    default: () => <section data-testid="token-view">Token</section>,
}))
vi.mock('./features/tokens/components/TokenSelectorOverlay.jsx', () => ({
    default: () => null,
}))
vi.mock('./features/passkey/components/PistachioWalletController.jsx', () => ({
    default: function TestWalletController() {
        const [pendingConnection, setPendingConnection] = useState(false)
        useEffect(() => {
            mocks.mounted()
            return () => mocks.unmounted()
        }, [])
        return (
            <button
                data-testid="pistachio-wallet-controller"
                type="button"
                aria-pressed={pendingConnection}
                onClick={() => setPendingConnection(value => !value)}
            >
                Local wallet
            </button>
        )
    },
}))

import App from './App.jsx'

describe('global Pistachio Wallet controller across all app views', () => {
    beforeEach(() => {
        mocks.view = 'trade'
        vi.clearAllMocks()
    })
    afterEach(() => cleanup())

    it('keeps exactly one controller mounted while navigating Swap, Portfolio and token details', () => {
        const { rerender } = render(<App />)
        const controller = screen.getByTestId('pistachio-wallet-controller')
        expect(mocks.mounted).toHaveBeenCalledOnce()
        expect(controller.getAttribute('aria-pressed')).toBe('false')

        // A connector request can remain pending while the route changes.
        // Its controller must not unmount or lose local state.
        fireEvent.click(controller)
        expect(controller.getAttribute('aria-pressed')).toBe('true')

        for (const [view, testId] of [
            ['portfolio', 'portfolio-view'],
            ['token', 'token-view'],
            ['trade', 'swap-view'],
            ['portfolio', 'portfolio-view'],
        ]) {
            mocks.view = view
            rerender(<App />)
            expect(screen.getByTestId(testId)).toBeTruthy()
            expect(screen.getAllByTestId('pistachio-wallet-controller')).toHaveLength(1)
            expect(screen.getByTestId('pistachio-wallet-controller')).toBe(controller)
            expect(controller.getAttribute('aria-pressed')).toBe('true')
            expect(mocks.mounted).toHaveBeenCalledOnce()
            expect(mocks.unmounted).not.toHaveBeenCalled()
        }
    })

    it('prevents duplicate or page-dependent controller mounts from returning', () => {
        const root = readFileSync('src/App.jsx', 'utf8')
        const layout = readFileSync('src/app/AppLayout.jsx', 'utf8')
        expect(root).toContain('overlays={<PistachioWalletController />}')
        expect(layout).toContain('{overlays}')
        for (const path of [
            'src/app/AppContent.jsx',
            'src/features/swap/components/SwapPage.jsx',
            'src/features/portfolio/components/PortfolioPage.jsx',
            'src/features/tokens/components/TokenDetailsPage.jsx',
        ]) {
            const source = readFileSync(path, 'utf8')
            expect(source, path).not.toContain('<PistachioWalletController')
        }
    })
})
