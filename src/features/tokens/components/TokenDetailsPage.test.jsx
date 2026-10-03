// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

afterEach(() => cleanup())

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
    it('renders Pistachio token details with real market stats and the swap rail', async () => {
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
            expect(screen.getByText(label, { selector: '.token-details-stat > span' })).toBeTruthy()
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

    it('fetches the selected history period', async () => {
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
    it('shows unavailable stats and period changes without manufacturing zero', async () => {
        mocks.fetchMarket.mockResolvedValue({ currentPriceUsd: null, periodChangePercent: null, chart: { points: [] }, stats: { marketCapUsd: null } })
        render(<TokenDetailsPage token={{ ...TOKEN, priceUSD: null, volume24hUsd: null, fdvUsd: null }} page={PAGE} />)
        await waitFor(() => expect(screen.getByText('Change unavailable · 1D')).toBeTruthy())
        expect(screen.queryByText('$0.00')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Volume' }))
        expect(screen.getByRole('button', { name: 'Volume' }).getAttribute('aria-pressed')).toBe('true')
    })
    it('rejects late data from a previous timeframe and aborts its request', async () => {
        let resolveDay
        mocks.fetchMarket.mockImplementationOnce(() => new Promise((resolve) => { resolveDay = resolve }))
        render(<TokenDetailsPage token={TOKEN} page={PAGE} />)
        await waitFor(() => expect(mocks.fetchMarket).toHaveBeenCalledTimes(1))
        const daySignal = mocks.fetchMarket.mock.calls[0][1].signal
        fireEvent.click(screen.getByRole('button', { name: '1W' }))
        await waitFor(() => expect(mocks.fetchMarket).toHaveBeenCalledTimes(2))
        expect(daySignal.aborted).toBe(true)
        resolveDay({ currentPriceUsd: 999, chart: { points: [] } })
        await waitFor(() => expect(screen.queryByText('$999.00')).toBeNull())
    })

})

 it('requests provider candles and exposes honest TVL and token-link controls', async () => {
    render(<TokenDetailsPage token={TOKEN} page={PAGE} />)
    await waitFor(() => expect(mocks.fetchMarket).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Candlestick chart' }))
    await waitFor(() => expect(mocks.fetchMarket).toHaveBeenLastCalledWith(TOKEN, expect.objectContaining({ chartStyle: 'candles' })))
    fireEvent.click(screen.getByRole('button', { name: 'TVL', exact: true }))
    expect(screen.getByRole('button', { name: 'TVL', exact: true }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'More token options' }))
    expect(screen.getByRole('link', { name: /View on explorer/ }).href).toContain(TOKEN.address)
 })
