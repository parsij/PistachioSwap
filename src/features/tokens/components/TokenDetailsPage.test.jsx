// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TokenDetailsPage from './TokenDetailsPage.jsx'

const mocks = vi.hoisted(() => ({
    fetchMarket: vi.fn(),
}))

vi.mock('../services/tokenDetails.js', () => ({
    fetchTokenMarketDetails: mocks.fetchMarket,
}))
vi.mock('./TokenMarketChart.jsx', () => ({
    default: () => <div data-testid="token-market-chart" />,
}))
vi.mock('./TokenIcon.jsx', () => ({
    default: ({ token }) => <span>{token?.symbol}</span>,
}))
vi.mock('../../swap/components/SwapToolbar.jsx', () => ({
    default: () => <div data-testid="swap-toolbar" />,
}))
vi.mock('../../swap/components/SwapCard.jsx', () => ({
    default: () => <div data-testid="swap-card" />,
}))
vi.mock('./TokenSelectorOverlay.jsx', () => ({ default: () => null }))
vi.mock('../../gas-assist/components/GasAssistDialogs.jsx', () => ({ default: () => null }))
vi.mock('../../swap/components/SameChainReviewDialog.jsx', () => ({ default: () => null }))
vi.mock('../../cross-chain/components/CrossChainReviewDialog.jsx', () => ({ default: () => null }))
vi.mock('../../passkey/components/PistachioWalletController.jsx', () => ({ default: () => null }))
vi.mock('../../wallet/components/wallet/PendingWalletOperation.jsx', () => ({ default: () => null }))

const TOKEN = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000001',
    name: 'Example Token',
    symbol: 'EXT',
    priceUSD: '12',
    volume24hUsd: 90_000,
    fdvUsd: 1_500_000,
}

const PAGE = {
    operationStatus: {},
    toolbar: {},
    card: {},
    tokenSelector: {},
    gasAssistDialogs: {},
    sameChainReview: {},
    crossChainReview: {},
}

beforeEach(() => {
    mocks.fetchMarket.mockReset()
    mocks.fetchMarket.mockResolvedValue({
        name: 'Example Token',
        symbol: 'EXT',
        currentPriceUsd: 12,
        periodChangePercent: 20,
        periodChangeUsd: 2,
        chart: {
            period: '1D',
            points: [
                { timestamp: 1_000, priceUsd: 10, volumeUsd: 80 },
                { timestamp: 2_000, priceUsd: 12, volumeUsd: 90 },
            ],
        },
        stats: {
            tvlUsd: 250_000,
            marketCapUsd: 1_000_000,
            fdvUsd: 1_500_000,
            volume24hUsd: 90_000,
            high52wUsd: 20,
            low52wUsd: 5,
        },
    })
})

describe('TokenDetailsPage', () => {
    it('renders the uploaded-Uniswap TDP structure with real market stats and the swap rail', async () => {
        render(<TokenDetailsPage token={TOKEN} page={PAGE} />)

        expect(screen.getByText('Tokens')).toBeTruthy()
        expect(screen.getAllByText('EXT').length).toBeGreaterThan(0)
        expect(screen.getByText('Stats')).toBeTruthy()
        for (const label of [
            'TVL',
            'Market cap',
            'FDV',
            '1 day volume',
            '52W High',
            '52W Low',
        ]) {
            expect(screen.getByText(label)).toBeTruthy()
        }
        expect(screen.getByTestId('swap-toolbar')).toBeTruthy()
        expect(screen.getByTestId('swap-card')).toBeTruthy()

        await waitFor(() => {
            expect(mocks.fetchMarket).toHaveBeenCalledWith(
                TOKEN,
                expect.objectContaining({
                    period: '1D',
                    includeYearStats: true,
                }),
            )
        })
    })

    it('uses the same period selector pattern as the uploaded Uniswap TDP', async () => {
        render(<TokenDetailsPage token={TOKEN} page={PAGE} />)
        await waitFor(() => expect(mocks.fetchMarket).toHaveBeenCalledTimes(1))

        fireEvent.click(screen.getByRole('button', { name: '1W' }))

        await waitFor(() => {
            expect(mocks.fetchMarket).toHaveBeenLastCalledWith(
                TOKEN,
                expect.objectContaining({ period: '1W' }),
            )
        })
    })
})
