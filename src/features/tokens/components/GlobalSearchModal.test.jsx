// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TokenSelector from './TokenSelector.jsx'

const TOKEN = {
    id: '56:0x0000000000000000000000000000000000000001',
    chainId: 56,
    address: '0x0000000000000000000000000000000000000001',
    isNative: false,
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    volume24hUsd: '1000000',
    liquidityUsd: '1000000',
    recognitionStatus: 'established',
    recognitionReasons: ['curated-official-contract'],
    verificationStatus: 'established',
    verificationReasons: ['coingecko-exact-contract', 'minimum-liquidity-met'],
    classificationTier: 'established',
    securityStatus: 'trusted',
    possibleSpam: false,
    visibility: 'primary',
    includeInPortfolioValue: true,
    priceConfidence: 'trusted',
}

function renderSearch(overrides = {}) {
    const props = {
        side: 'buy',
        mode: 'global-search',
        chainId: 'all',
        tokens: [TOKEN],
        commonTokens: [],
        fallbackTokens: [],
        walletTokens: [],
        search: '',
        loading: false,
        error: null,
        currentToken: null,
        oppositeToken: null,
        onSearchChange: vi.fn(),
        onSelect: vi.fn(),
        onClose: vi.fn(),
        onChainChange: vi.fn(),
        ...overrides,
    }
    return { props, view: render(<TokenSelector {...props} />) }
}

beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState({}, '', '/swap/?view=portfolio')
})

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('GlobalSearchModal', () => {
    it('is a dedicated search surface rather than the swap token picker', () => {
        renderSearch()

        expect(screen.getByRole('dialog', { name: 'Search' })).toBeTruthy()
        expect(screen.getByRole('textbox', { name: 'Search tokens and wallets' })).toBeTruthy()
        expect(screen.getByRole('button', { name: 'All' })).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Tokens' })).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Wallets' })).toBeTruthy()
        expect(document.querySelector('.global-search-modal')).toBeTruthy()
        expect(document.querySelector('.ps-token-selector-dialog')).toBeNull()
    })

    it('uses the existing trusted token state and returns token selection', () => {
        const onSelect = vi.fn()
        renderSearch({
            search: 'usdc',
            onSelect,
        })

        fireEvent.click(screen.getByText('USD Coin').closest('.global-search-result-row'))
        expect(onSelect).toHaveBeenCalledWith(TOKEN)
    })

    it('opens an exact EVM wallet result in the portfolio view', () => {
        const address = '0x2222222222222222222222222222222222222222'
        const onClose = vi.fn()
        renderSearch({
            search: address,
            onClose,
        })

        fireEvent.click(screen.getByText('View portfolio').closest('button'))

        const url = new URL(window.location.href)
        expect(url.searchParams.get('view')).toBe('portfolio')
        expect(url.searchParams.get('address')).toBe(address)
        expect(onClose).toHaveBeenCalledOnce()
    })
})
