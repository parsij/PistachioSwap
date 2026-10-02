// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppHeader from './AppHeader.jsx'

vi.mock('../features/wallet/components/WalletConnectionButton.jsx', () => ({
    default: () => <div data-testid="wallet-button" />,
}))

vi.mock('../features/passkey/components/PistachioWalletController.jsx', () => ({
    PistachioWalletButton: () => <div data-testid="pistachio-wallet" />,
}))

describe('application header', () => {
    beforeEach(() => {
        window.history.replaceState({}, '', '/swap/')
        window.matchMedia = vi.fn((query) => ({
            matches: false,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }))
    })

    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it('keeps wallet controls and routes the pistachio icon to landing', () => {
        render(
            <AppHeader
                brand={{ name: 'PistachioSwap' }}
                navigation={[
                    { label: 'Trade', href: '/swap/' },
                    { label: 'Portfolio', href: '/swap/?view=portfolio' },
                ]}
                search={{ label: 'Search', onOpen: vi.fn() }}
                wallet={{}}
            />,
        )

        expect(screen.getByRole('link', { name: 'PistachioSwap landing page' }).getAttribute('href'))
            .toBe('/')
        expect(screen.getByRole('button', { name: 'Open product menu' })).toBeTruthy()
        expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy()
        expect(screen.getByRole('link', { name: 'Trade' }).getAttribute('aria-current')).toBe('page')
        expect(screen.getByRole('link', { name: 'Portfolio' }).getAttribute('aria-current')).toBeNull()
        expect(screen.getByRole('button', { name: 'Search tokens' })).toBeTruthy()
        expect(screen.getByTestId('pistachio-wallet')).toBeTruthy()
        expect(screen.getByTestId('wallet-button')).toBeTruthy()
    })

    it('marks the portfolio route active without reloading the wallet app', () => {
        window.history.replaceState({}, '', '/swap/?view=portfolio')
        const navigation = [
            { label: 'Trade', href: '/swap/' },
            { label: 'Portfolio', href: '/swap/?view=portfolio' },
        ]
        render(
            <AppHeader
                brand={{ name: 'PistachioSwap' }}
                navigation={navigation}
                wallet={{}}
            />,
        )

        const portfolio = screen.getByRole('link', { name: 'Portfolio' })
        expect(portfolio.getAttribute('aria-current')).toBe('page')

        fireEvent.click(screen.getByRole('link', { name: 'Trade' }))
        expect(window.location.pathname).toBe('/swap/')
        expect(new URLSearchParams(window.location.search).get('view')).toBeNull()
    })
})
