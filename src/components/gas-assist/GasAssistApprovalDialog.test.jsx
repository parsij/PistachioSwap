// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import GasAssistApprovalDialog from './GasAssistApprovalDialog.jsx'

const token = { symbol: 'USDT', address: '0x0000000000000000000000000000000000000001', decimals: 6 }
const quote = {
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    sellAmount: '995000',
    buyAmount: '1000000000000000',
    minBuyAmount: '900000000000000',
    fees: {
        gasFee: { amount: '1000', token: token.address },
        zeroExFee: { amount: '2000', token: token.address },
        integratorFee: { amount: '3000', token: token.address },
    },
    approval: {
        approvalAmount: (2n ** 256n - 1n).toString(),
        isUnlimited: true,
    },
}

describe('0x Gas Assist dialog', () => {
    it('displays output, minimum, all fees, and unlimited permit disclosure', () => {
        render(<GasAssistApprovalDialog dialog={{ open: true, state: 'ready', quote }} token={token} amount="1" onClose={() => {}} onConfirm={() => {}} />)
        expect(screen.getByText('Expected native BNB')).toBeTruthy()
        expect(screen.getByText('Minimum native BNB')).toBeTruthy()
        expect(screen.getByText('0x gas fee')).toBeTruthy()
        expect(screen.getByText('0x fee')).toBeTruthy()
        expect(screen.getByText('PistachioSwap fee')).toBeTruthy()
        expect(screen.getByText(/reusable token allowance/i)).toBeTruthy()
    })

    it('requests signing only after explicit confirmation', () => {
        const onConfirm = vi.fn()
        render(<GasAssistApprovalDialog dialog={{ open: true, state: 'ready', quote: { ...quote, approval: null } }} token={token} amount="1" onClose={() => {}} onConfirm={onConfirm} />)
        expect(onConfirm).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Confirm Gas Assist trade' }))
        expect(onConfirm).toHaveBeenCalledOnce()
    })

    it('shows on-chain approval rejection without a signing button', () => {
        render(<GasAssistApprovalDialog dialog={{ open: true, state: 'failed', quote: null, error: { code: 'ONCHAIN_APPROVAL_REQUIRED' } }} token={token} amount="1" onClose={() => {}} onConfirm={() => {}} />)
        expect(screen.getByText(/one-time on-chain approval/i)).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'Confirm Gas Assist trade' })).toBeNull()
    })
})
