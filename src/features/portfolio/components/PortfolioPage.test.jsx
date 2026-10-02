// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import PortfolioPage from './PortfolioPage.jsx'

vi.mock('../../wallet/hooks/useWalletActivity.js', () => ({
    useWalletActivity: () => ({
        items: [],
        loading: false,
        error: null,
        refetch: vi.fn(),
    }),
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
    window.history.replaceState({}, '', '/swap/')
})

describe('PortfolioPage', () => {
    it('renders a real balance overview from wallet-token data', () => {
        render(<PortfolioPage wallet={wallet()} />)

        expect(screen.getByText('$12.50')).toBeTruthy()
        expect(screen.getByText('USD Coin')).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Tokens' })).toBeTruthy()
    })

    it('filters the full token view locally', () => {
        render(<PortfolioPage wallet={wallet()} />)

        fireEvent.click(screen.getByRole('button', { name: 'Tokens' }))
        fireEvent.change(screen.getByRole('textbox', { name: 'Search portfolio tokens' }), {
            target: { value: 'nope' },
        })

        expect(screen.getByText('No matching tokens.')).toBeTruthy()
    })

    it('keeps disconnected state informative instead of rendering fake balances', () => {
        render(<PortfolioPage wallet={wallet({
            walletState: { isConnected: false, address: null },
            walletTokens: [],
        })} />)

        expect(screen.getByText('Your portfolio')).toBeTruthy()
        expect(screen.getByText(/Connect a wallet from the header/)).toBeTruthy()
    })
})
