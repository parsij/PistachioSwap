// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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
                wallet={{}}
            />,
        )

        expect(screen.getByRole('link', { name: 'PistachioSwap landing page' }).getAttribute('href'))
            .toBe('/landing/')
        expect(screen.getByRole('button', { name: 'Open product menu' })).toBeTruthy()
        expect(screen.getByTestId('pistachio-wallet')).toBeTruthy()
        expect(screen.getByTestId('wallet-button')).toBeTruthy()
    })
})
