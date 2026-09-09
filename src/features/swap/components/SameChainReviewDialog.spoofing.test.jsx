// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SameChainReviewDialog from './SameChainReviewDialog.jsx'

const REAL_USDC = {
    chainId: 56,
    address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    symbol: 'USDC',
    decimals: 18,
}

function renderReview(buyToken, overrides = {}) {
    return render(
        <SameChainReviewDialog
            open
            onOpenChange={() => {}}
            contentRef={undefined}
            reducedMotion
            activeAmountSide="sell"
            sellAmount="1"
            buyAmount="4900"
            sellToken={REAL_USDC}
            buyToken={buyToken}
            maximumSold={null}
            minimumReceived={null}
            quoteProvider="pancakeswap"
            slippageLabel="0.5%"
            reviewError={null}
            confirmDisabled={false}
            confirmLabel="Confirm swap"
            onConfirm={() => {}}
            {...overrides}
        />,
    )
}

describe('review dialog token identity', () => {
    afterEach(cleanup)

    it('shows a genuine symbol unchanged', () => {
        renderReview({ ...REAL_USDC, symbol: 'CAKE' })
        expect(screen.getByText(/4900 CAKE/)).toBeTruthy()
    })

    it.each([
        ['a Cyrillic homograph', 'USDС'],
        ['a right-to-left override', 'US‮DC'],
        ['a zero-width joiner', 'USD‍C'],
        ['an overlong symbol', 'U'.repeat(64)],
    ])('refuses to render %s at the confirmation step', (_label, symbol) => {
        // The last screen before the wallet signature must not be able to show
        // a symbol that reads as a token the user did not choose.
        const { container } = renderReview({
            ...REAL_USDC,
            address: '0x00000000000000000000000000000000000000ff',
            symbol,
        })

        expect(container.textContent).not.toContain(symbol)
        // Falls back to the contract identity, which cannot be impersonated.
        expect(screen.getByText(/4900 0x0000…00ff/)).toBeTruthy()
    })

    it('shows a non-dismissible waiting screen after the transaction is submitted', () => {
        const onOpenChange = vi.fn()
        renderReview(
            { ...REAL_USDC, symbol: 'CAKE' },
            {
                onOpenChange,
                confirmDisabled: true,
                confirmLabel: 'Waiting for confirmation...',
            },
        )

        expect(screen.getByText('Swap submitted')).toBeTruthy()
        expect(screen.getByText('Waiting for confirmation')).toBeTruthy()
        expect(screen.getByText(/Recent Activity and your wallet token balances will refresh automatically/)).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'Close review' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
        expect(onOpenChange).not.toHaveBeenCalledWith(false)
    })
})
