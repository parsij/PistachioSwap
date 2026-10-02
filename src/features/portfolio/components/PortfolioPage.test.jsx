// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import PortfolioPage from './PortfolioPage.jsx'

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

afterEach(() => {
    cleanup()
    window.history.replaceState({}, '', '/swap/?view=portfolio')
    window.localStorage.clear()
    vi.restoreAllMocks()
    externalWalletTokens.mockReset()
    externalWalletTokens.mockReturnValue({
        tokens: [],
        loading: false,
        error: null,
        refetch: vi.fn(),
    })
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
