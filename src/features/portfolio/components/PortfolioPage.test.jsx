// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PortfolioPage from './PortfolioPage.jsx'
import { recordPortfolioSnapshot } from '../services/portfolioHistory.js'

const externalWalletTokens = vi.fn()

vi.mock('../../wallet/hooks/useWalletActivity.js', () => ({
    useWalletActivity: () => ({
        items: [],
        loading: false,
        error: null,
        refetch: vi.fn(),
    }),
}))

vi.mock('../../tokens/hooks/useWalletTokens.js', () => ({
    useWalletTokens: (...args) => externalWalletTokens(...args),
}))

const TOKEN = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000001',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    balance: '12.5',
    formattedBalance: '12.5',
    rawBalance: '12500000',
    valueUSD: '12.50',
    trustedPriceUSD: '1',
    priceChange24hPercent: 1.25,
    priceConfidence: 'trusted',
    recognitionStatus: 'established',
    recognitionReasons: ['curated-official-contract'],
    classificationTier: 'established',
    classificationReasons: ['curated-official-contract'],
    securityStatus: 'trusted',
    spamStatus: 'clean',
    possibleSpam: false,
    visibility: 'primary',
    includeInPortfolioValue: true,
}

function wallet(overrides = {}) {
    return {
        walletState: {
            isConnected: true,
            address: '0x1111111111111111111111111111111111111111',
        },
        walletTokens: [TOKEN],
        settings: {
            hideUnknownTokens: true,
            hideSmallBalances: false,
        },
        selectedTokens: [],
        onRefetch: vi.fn(),
        ...overrides,
    }
}

beforeEach(() => {
    window.history.replaceState({}, '', '/swap/?view=portfolio')
    window.localStorage.clear()
    externalWalletTokens.mockReset()
    externalWalletTokens.mockReturnValue({
        tokens: [],
        loading: false,
        error: null,
        refetch: vi.fn(),
    })
})

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('PortfolioPage', () => {
    it('matches the wide Uniswap-style information architecture with real wallet data', () => {
        render(<PortfolioPage wallet={wallet()} />)

        expect(screen.getAllByText('$12.50').length).toBeGreaterThan(0)
        expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy()
        expect(screen.getByRole('button', { name: /All networks/ })).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-current'))
            .toBe('page')
        expect(screen.getByRole('button', { name: 'NFTs' })).toBeTruthy()
        expect(screen.getByText('Performance')).toBeTruthy()
        expect(screen.getByRole('button', { name: '1M' }).className).toContain('active')
        expect(screen.getByText('USD Coin')).toBeTruthy()
        expect(document.querySelector('.uni-portfolio-hero')).toBeTruthy()
        expect(document.querySelector('.uni-portfolio-right-rail')).toBeTruthy()
        expect(document.querySelector('.uni-portfolio-token-table-head')).toBeTruthy()
    })

    it('searches portfolio networks locally and restores the full list on reopening', () => {
        render(<PortfolioPage wallet={wallet()} />)
        const trigger = screen.getByRole('button', { name: /All networks/ })
        fireEvent.click(trigger)
        const search = screen.getByRole('textbox', { name: 'Search networks' })
        fireEvent.change(search, { target: { value: 'base' } })
        expect(screen.getAllByRole('option')).toHaveLength(1)
        expect(screen.getByRole('option', { name: 'Base' })).toBeTruthy()
        fireEvent.change(search, { target: { value: 'missing-network' } })
        expect(screen.getByRole('status').textContent).toBe('No networks found')
        fireEvent.keyDown(search, { key: 'Escape' })
        fireEvent.click(trigger)
        expect(screen.getByRole('textbox', { name: 'Search networks' }).value).toBe('')
        expect(screen.getAllByRole('option').length).toBeGreaterThan(20)
    })

    it('uses the same canonical All Chains icon in the trigger and menu and dismisses with Escape', () => {
        render(<PortfolioPage wallet={wallet()} />)
        const trigger = screen.getByRole('button', { name: /All networks/ })
        fireEvent.click(trigger)
        const option = screen.getByRole('option', { name: 'All networks' })
        expect(trigger.querySelector('.ps-chain-icon-all svg').outerHTML)
            .toBe(option.querySelector('.ps-chain-icon-all svg').outerHTML)
        fireEvent.keyDown(option, { key: 'Escape' })
        expect(screen.queryByRole('listbox')).toBeNull()
        expect(document.activeElement).toBe(trigger)
    })

    it('renders zero-decimal chart axis labels without invalid NumberFormat options', () => {
        const walletAddress = wallet().walletState.address
        const now = Date.now()
        recordPortfolioSnapshot({
            walletAddress,
            valueUSD: 10,
            now: now - 60_000,
        })
        recordPortfolioSnapshot({
            walletAddress,
            valueUSD: 12.5,
            now,
        })

        expect(() => render(<PortfolioPage wallet={wallet()} />)).not.toThrow()
        expect(screen.getByRole('img', { name: 'Portfolio value history' })).toBeTruthy()
    })

    it('shows a visible current-value chart and a tappable performance explanation immediately', () => {
        render(<PortfolioPage wallet={wallet()} />)

        const line = document.querySelector('.uni-portfolio-chart-line')
        expect(line).toBeTruthy()
        expect(line.getAttribute('d')).toContain(' L ')
        expect(screen.getByText('Current value shown. History builds while you use this browser.')).toBeTruthy()
        expect(screen.getAllByText('Not tracked')).toHaveLength(2)
        expect(screen.getByText('$0.00 (0.00%)')).toBeTruthy()

        fireEvent.click(screen.getByRole('button', { name: 'About portfolio performance' }))
        expect(screen.getByRole('note').textContent).toContain('Realized and unrealized cost-basis P/L')
    })

    it('uses the full tokens tab search without changing portfolio data ownership', () => {
        render(<PortfolioPage wallet={wallet()} />)

        fireEvent.click(screen.getByRole('button', { name: 'Tokens' }))
        fireEvent.change(screen.getByRole('textbox', { name: 'Search portfolio tokens' }), {
            target: { value: 'nope' },
        })

        expect(screen.getByText('No matching tokens')).toBeTruthy()
    })

    it('shows the NFT tab honestly when NFT indexing is unavailable', () => {
        render(<PortfolioPage wallet={wallet()} />)

        fireEvent.click(screen.getByRole('button', { name: 'NFTs' }))

        expect(screen.getByText('NFT indexing is not enabled')).toBeTruthy()
        expect(screen.getByText(/does not currently load NFT inventory/)).toBeTruthy()
    })

    it('loads an external address through the existing all-chain wallet-token hook', () => {
        const externalAddress = '0x2222222222222222222222222222222222222222'
        externalWalletTokens.mockReturnValue({
            tokens: [TOKEN],
            loading: false,
            error: null,
            refetch: vi.fn(),
        })
        window.history.replaceState(
            {},
            '',
            '/swap/?view=portfolio&address=' + externalAddress,
        )

        render(<PortfolioPage wallet={wallet()} />)

        expect(externalWalletTokens).toHaveBeenCalledWith({
            chainId: 'all',
            walletAddress: externalAddress,
            enabled: true,
        })
        expect(screen.getAllByText('$12.50').length).toBeGreaterThan(0)
        expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
    })

    it('keeps disconnected state informative instead of fabricating a portfolio', () => {
        render(<PortfolioPage wallet={wallet({
            walletState: { isConnected: false, address: null },
            walletTokens: [],
        })} />)

        expect(screen.getByText('Your portfolio')).toBeTruthy()
        expect(screen.getByText(/Connect a wallet from the header/)).toBeTruthy()
    })
})
