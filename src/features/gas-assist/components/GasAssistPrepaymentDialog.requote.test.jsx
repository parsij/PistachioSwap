// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import GasAssistPrepaymentDialog from './GasAssistPrepaymentDialog.jsx'

afterEach(() => cleanup())

const sellToken = {
    address: '0x1111111111111111111111111111111111111111',
    symbol: 'SELL',
    decimals: 18,
}
const buyToken = {
    address: '0x2222222222222222222222222222222222222222',
    symbol: 'BUY',
    decimals: 18,
}

function failedRequote() {
    const refreshQuote = vi.fn()
    const retryStart = vi.fn()
    return {
        refreshQuote,
        retryStart,
        sponsorship: {
            open: true,
            phase: 'failed',
            error: {
                code: 'ORDER_REQUOTE_REQUIRED',
                message: 'The refreshed route moved outside the reviewed order.',
            },
            close: vi.fn(),
            refreshQuote,
            retryStart,
            signPackage: vi.fn(),
            order: {
                id: '00000000-0000-0000-0000-000000000001',
                status: 'expired',
                currentRequiredAction: 'prepare-payment',
                grossInputAmountRaw: '100000000000000000000',
                netSwapAmountRaw: '96000000000000000000',
                paymentToken: sellToken.address,
                paymentAmountRaw: '4000000000000000000',
                paymentTokenDecimals: 18,
                paymentTokenSymbol: 'SELL',
                gasReserveUsdMicros: '135000',
                fixedServiceFeeUsdMicros: '67000',
                platformFeeUsdMicros: '3000000',
                totalPrepaymentUsdMicros: '3202000',
                expectedOutputRaw: '95000000000000000000',
                minimumOutputRaw: '94000000000000000000',
                expiresAt: new Date(Date.now() + 300_000).toISOString(),
            },
        },
    }
}

describe('Gas Assist requote recovery', () => {
    it('replaces the dead-end retry with a real Refresh quote action', () => {
        const value = failedRequote()
        render(
            <GasAssistPrepaymentDialog
                sponsorship={value.sponsorship}
                sellToken={sellToken}
                buyToken={buyToken}
            />,
        )

        expect(screen.getByText('The price changed too much. Refresh and try again.')).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Swap using Gas Assist' })).toBeNull()

        fireEvent.click(screen.getByRole('button', { name: 'Refresh quote' }))
        expect(value.refreshQuote).toHaveBeenCalledOnce()
        expect(value.retryStart).not.toHaveBeenCalled()
    })
})
