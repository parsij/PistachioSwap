// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import GasAssistPrepaymentDialog from './GasAssistPrepaymentDialog.jsx'

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

function sponsorship(overrides = {}) {
    return {
        open: true,
        phase: 'review',
        error: null,
        close: vi.fn(),
        signPayment: vi.fn(),
        signApproval: vi.fn(),
        requestContinuation: vi.fn(),
        signContinuation: vi.fn(),
        order: {
            id: '00000000-0000-0000-0000-000000000001',
            status: 'quoted',
            currentRequiredAction: 'prepare-payment',
            sellToken: sellToken.address,
            buyToken: buyToken.address,
            grossInputAmountRaw: '100000000000000000000',
            netSwapAmountRaw: '96000000000000000000',
            paymentToken: sellToken.address,
            paymentTokenReason: 'eligible-sell-token',
            paymentAmountRaw: '4000000000000000000',
            paymentTokenDecimals: 18,
            paymentTokenSymbol: 'SELL',
            estimatedPaymentGasUsdMicros: '20000',
            estimatedApprovalGasUsdMicros: '30000',
            estimatedSwapGasUsdMicros: '0',
            gasReserveUsdMicros: '75000',
            fixedServiceFeeUsdMicros: '67000',
            platformFeeUsdMicros: '3000000',
            conversionCostUsdMicros: '12000',
            totalPrepaymentUsdMicros: '3154000',
            expectedOutputRaw: '95000000000000000000',
            minimumOutputRaw: '94000000000000000000',
            providerFees: {
                gasFee: { amount: '5' },
                zeroExFee: { amount: '6' },
            },
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
        ...overrides,
    }
}

describe('Gas Assist prepayment review', () => {
    it('discloses the exact payment, fee split, provider fees, and separate actions', () => {
        const value = sponsorship()
        render(<GasAssistPrepaymentDialog sponsorship={value} sellToken={sellToken} buyToken={buyToken} />)
        expect(screen.getByText('Gas Assist Prepayment')).toBeTruthy()
        expect(screen.getByText('Gross amount supplied')).toBeTruthy()
        expect(screen.getByText('Exact sponsorship payment')).toBeTruthy()
        expect(screen.getByText('1.5× gas reserve')).toBeTruthy()
        expect(screen.getByText('Fixed service fee')).toBeTruthy()
        expect(screen.getByText('3% trade fee')).toBeTruthy()
        expect(screen.getByText('Token-to-BNB conversion cost')).toBeTruthy()
        expect(screen.queryByText('Commercial fee cap')).toBeNull()
        expect(screen.getByText('Net swap input')).toBeTruthy()
        expect(screen.getByText('0x gas fee')).toBeTruthy()
        expect(screen.getByText('0x fee')).toBeTruthy()
        expect(screen.getByText(/signs only the exact backend-prepared token/)).toBeTruthy()
        expect(screen.getByText(/rejects any changed or user-created transaction/)).toBeTruthy()
        expect(screen.getByText(/separate transactions and are not atomic/)).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Sign exact payment transaction' }))
        expect(value.signPayment).toHaveBeenCalledOnce()
    })

    it('shows the Pistachio Wallet compatibility error', () => {
        render(<GasAssistPrepaymentDialog
            sponsorship={sponsorship({
                phase: 'unsupported',
                order: null,
                error: {
                    code: 'PISTACHIO_WALLET_REQUIRED',
                    message: 'Gas Assist requires Pistachio Wallet.',
                },
            })}
            sellToken={sellToken}
            buyToken={buyToken}
        />)
        expect(screen.getByText('Gas Assist requires Pistachio Wallet.')).toBeTruthy()
    })

    it('does not render MetaMask sponsored-signing controls', () => {
        render(<GasAssistPrepaymentDialog
            sponsorship={sponsorship({
                phase: 'unsupported',
                order: null,
                metaMaskSigner: {
                    isMetaMask: true,
                    capability: { status: 'not-connected' },
                },
                error: {
                    code: 'PISTACHIO_WALLET_REQUIRED',
                    message: 'Gas Assist requires Pistachio Wallet.',
                },
            })}
            sellToken={sellToken}
            buyToken={buyToken}
        />)
        expect(screen.queryByText('Enable MetaMask sponsored signing')).toBeNull()
        expect(screen.queryByRole('button', { name: 'Connect MetaMask signing' })).toBeNull()
    })
})
