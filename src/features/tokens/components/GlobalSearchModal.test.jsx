// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
    it('shows the full available token list immediately on All without a tab switch', () => {
        const tokens = Array.from({ length: 8 }, (_, i) => ({ ...TOKEN, address: `0x${(i + 1).toString(16).padStart(40, '0')}`, name: `Canonical ${i}` }))
        renderSearch({ tokens })
        expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true')
        for (const token of tokens) expect(screen.getByText(token.name)).toBeTruthy()
    })
    it('is a dedicated search surface rather than the swap token picker', () => {
        renderSearch()

        expect(screen.getByRole('dialog', { name: 'Search' })).toBeTruthy()
        const input = screen.getByRole('textbox', { name: 'Search tokens and wallets' })
        expect(input.getAttribute('placeholder')).toBe('Search by name, symbol, or address')
        expect(screen.getByRole('tab', { name: 'All' })).toBeTruthy()
        expect(screen.getByRole('tab', { name: 'Tokens' })).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'Pools' })).toBeNull()
        expect(screen.getByRole('tab', { name: 'Wallets' })).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'Auctions' })).toBeNull()
        expect(screen.getAllByText('Tokens').length).toBeGreaterThanOrEqual(2)
        expect(screen.queryByText('Pools by 24H volume')).toBeNull()
        expect(screen.queryByText('Your tokens')).toBeNull()
        expect(document.querySelector('.global-search-footer')).toBeNull()
        expect(document.querySelector('.global-search-modal')).toBeTruthy()
        expect(document.querySelector('.ps-token-selector-dialog')).toBeNull()
    })

    it('uses an opaque search backdrop without blur', () => {
        const css = readFileSync(
            resolve('src/features/tokens/components/GlobalSearchModal.css'),
            'utf8',
        )

        expect(css).toMatch(
            /\.global-search-backdrop\s*\{[\s\S]*?background:\s*#0f0f0f;[\s\S]*?backdrop-filter:\s*none;/,
        )
    })

    it('shows the same fallback token selection even when 24H volume is unavailable', () => {
        const fallbackToken = {
            ...TOKEN,
            id: '56:0x0000000000000000000000000000000000000002',
            address: '0x0000000000000000000000000000000000000002',
            name: 'Fallback Coin',
            symbol: 'FALL',
            volume24hUsd: null,
            priceUSD: '2.5',
            priceChange24hPercent: -1.25,
        }

        renderSearch({
            tokens: [],
            commonTokens: [fallbackToken],
            fallbackTokens: [fallbackToken],
        })

        expect(screen.getByText('Fallback Coin')).toBeTruthy()
        expect(screen.getByText('$2.50')).toBeTruthy()
        expect(screen.getByText('-1.25%')).toBeTruthy()
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

    it('searches canonical tokens with missing market metrics and selects with the keyboard', () => {
        const token = { ...TOKEN, volume24hUsd: null, liquidityUsd: null, priceUSD: null, priceChange24hPercent: null }
        const { props } = renderSearch({ tokens: [token], search: 'usdc' })
        expect(screen.getByText('USD Coin')).toBeTruthy()
        expect(screen.queryByText('$0.00')).toBeNull()
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
        expect(props.onSelect).toHaveBeenCalledWith(token)
    })

    it('does not reset an explicitly selected network', () => {
        const { props } = renderSearch({ chainId: 56 })
        expect(props.onChainChange).not.toHaveBeenCalled()
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
