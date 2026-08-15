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

function sponsorship(overrides = {}) {
    return {
        open: true,
        phase: 'review',
        error: null,
        lastPollError: null,
        close: vi.fn(),
        retryStart: vi.fn(),
        signPackage: vi.fn(),
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
            estimatedSwapGasUsdMicros: '40000',
            gasReserveUsdMicros: '135000',
            fixedServiceFeeUsdMicros: '67000',
            platformFeeUsdMicros: '3000000',
            conversionCostUsdMicros: '0',
            totalPrepaymentUsdMicros: '3202000',
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
    it('shows one simple no-BNB action and keeps technical details collapsed by default', () => {
        const value = sponsorship()
        render(<GasAssistPrepaymentDialog sponsorship={value} sellToken={sellToken} buyToken={buyToken} />)

        expect(screen.getByText('Review Gas Assisted Swap')).toBeTruthy()
        expect(screen.getByText('No BNB needed')).toBeTruthy()
        expect(screen.getByText('You pay')).toBeTruthy()
        expect(screen.getByText('You receive')).toBeTruthy()
        expect(screen.getByText('Gas Assist fee')).toBeTruthy()
        expect(screen.getByText(/One tap starts the flow/)).toBeTruthy()

        const details = screen.getByText('Transaction details').closest('details')
        expect(details?.hasAttribute('open')).toBe(false)
        expect(screen.getByText('Net swap input')).toBeTruthy()
        expect(screen.getByText('Minimum output')).toBeTruthy()
        expect(screen.getByText(/separate blockchain transactions/)).toBeTruthy()

        fireEvent.click(screen.getByRole('button', { name: 'Swap using Gas Assist' }))
        expect(value.signPackage).toHaveBeenCalledOnce()
        expect(value.signPayment).not.toHaveBeenCalled()
    })

    it('explains that cross-chain MegaFuel sponsorship does not top up the wallet', () => {
        render(<GasAssistPrepaymentDialog
            sponsorship={sponsorship()}
            sellToken={sellToken}
            buyToken={buyToken}
            purpose="cross-chain-gas"
        />)

        expect(screen.getByText('Review Gas Assisted Swap')).toBeTruthy()
        expect(screen.getByText(/No BNB is sent to your wallet/)).toBeTruthy()
        expect(screen.queryByText(/converts only/i)).toBeNull()
    })

    it('fully hands modal focus to Pistachio Wallet while authentication or signing is active', () => {
        const value = sponsorship({ phase: 'authenticating', order: null })
        const { container, rerender } = render(
            <GasAssistPrepaymentDialog
                sponsorship={value}
                sellToken={sellToken}
                buyToken={buyToken}
            />,
        )

        expect(container.firstChild).toBeNull()

        rerender(
            <GasAssistPrepaymentDialog
                sponsorship={sponsorship({ phase: 'package-signing' })}
                sellToken={sellToken}
                buyToken={buyToken}
            />,
        )
        expect(container.firstChild).toBeNull()

        rerender(
            <GasAssistPrepaymentDialog
                sponsorship={sponsorship({ phase: 'review' })}
                sellToken={sellToken}
                buyToken={buyToken}
            />,
        )
        expect(screen.getByText('Review Gas Assisted Swap')).toBeTruthy()
    })

    it('shows compact progress and prevents another primary submission while payment is pending', () => {
        render(<GasAssistPrepaymentDialog
            sponsorship={sponsorship({
                phase: 'payment-confirming',
                order: {
                    ...sponsorship().order,
                    status: 'payment-submitted',
                    currentRequiredAction: 'wait-payment-confirmation',
                    paymentTransactionHash: `0x${'1'.repeat(64)}`,
                    confirmationCount: 0,
                },
            })}
            sellToken={sellToken}
            buyToken={buyToken}
        />)

        expect(screen.getByText('Starting your gasless swap')).toBeTruthy()
        expect(screen.getByText(/Confirming the Gas Assist fee/)).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'Swap using Gas Assist' })).toBeNull()
        expect(document.querySelector('.gas-assist-compact-status')).toBeTruthy()
    })

    it('shows a simple wallet compatibility error and a retry action', () => {
        const value = sponsorship({
            phase: 'unsupported',
            order: null,
            error: {
                code: 'PISTACHIO_WALLET_REQUIRED',
                message: 'Gas Assist requires Pistachio Wallet.',
            },
        })
        render(<GasAssistPrepaymentDialog
            sponsorship={value}
            sellToken={sellToken}
            buyToken={buyToken}
        />)

        expect(screen.getByText('Gas Assist requires Pistachio Wallet.')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
        expect(value.retryStart).toHaveBeenCalledOnce()
    })

    it('refreshes an expired quote instead of presenting a generic retry', () => {
        const refreshQuote = vi.fn()
        const value = sponsorship({
            refreshQuote,
            order: {
                ...sponsorship().order,
                expiresAt: new Date(Date.now() - 1_000).toISOString(),
            },
        })
        render(<GasAssistPrepaymentDialog
            sponsorship={value}
            sellToken={sellToken}
            buyToken={buyToken}
        />)

        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Swap using Gas Assist' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Refresh quote' }))
        expect(refreshQuote).toHaveBeenCalledOnce()
        expect(value.retryStart).not.toHaveBeenCalled()
    })

    it('does not render generic backend failures beside an expired quote', () => {
        render(<GasAssistPrepaymentDialog
            sponsorship={sponsorship({
                error: {
                    code: 'GAS_ASSIST_FAILED',
                    message: 'Gas Assist could not complete the request.',
                },
                order: {
                    ...sponsorship().order,
                    expiresAt: new Date(Date.now() - 1_000).toISOString(),
                },
            })}
            sellToken={sellToken}
            buyToken={buyToken}
        />)

        expect(screen.getByText('Quote expired')).toBeTruthy()
        expect(screen.queryByText('Gas Assist could not complete the request.')).toBeNull()
    })

    it('does not leave the stale swap action enabled after a terminal failure', () => {
        render(<GasAssistPrepaymentDialog
            sponsorship={sponsorship({
                phase: 'failed',
                error: { code: 'INVALID_CHAIN', message: 'Invalid chain.' },
            })}
            sellToken={sellToken}
            buyToken={buyToken}
        />)

        expect(screen.queryByRole('button', { name: 'Swap using Gas Assist' })).toBeNull()
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    })

    it('shows a simple error without exposing backend diagnostics in the interface', () => {
        render(<GasAssistPrepaymentDialog
            sponsorship={sponsorship({
                phase: 'failed',
                error: {
                    code: 'PAYMASTER_POLICY_TIMEOUT',
                    message: 'The raw sponsor service timed out.',
                    stage: 'package.prepare',
                    requestId: 'request-123',
                },
            })}
            sellToken={sellToken}
            buyToken={buyToken}
        />)

        expect(screen.getByText('The sponsor policy service timed out. Try again.')).toBeTruthy()
        const details = screen.getByText('Transaction details').closest('details')
        expect(details?.hasAttribute('open')).toBe(false)
        expect(screen.queryByText('PAYMASTER_POLICY_TIMEOUT')).toBeNull()
        expect(screen.queryByText('package.prepare')).toBeNull()
        expect(screen.queryByText('request-123')).toBeNull()
        expect(screen.queryByText('The raw sponsor service timed out.')).toBeNull()
    })
})
