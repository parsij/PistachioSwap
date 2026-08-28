// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
    const state = { listener: null }
    const manager = {
        recordActivity: vi.fn(),
        reviewQueue: {
            approve: vi.fn(),
            reject: vi.fn(),
            subscribe: vi.fn((listener) => {
                state.listener = listener
                listener(null)
                return () => {
                    if (state.listener === listener) state.listener = null
                }
            }),
        },
    }
    return { manager, state }
})

vi.mock('../../services/walletUIOperations.js', () => ({
    walletUIOperations: mocks.manager,
}))

import { SigningReviewDialog } from './WalletSigningReview.jsx'

describe('Gas Assist package signing review', () => {
    beforeEach(() => {
        mocks.state.listener = null
        mocks.manager.recordActivity.mockClear()
        mocks.manager.reviewQueue.approve.mockClear()
        mocks.manager.reviewQueue.reject.mockClear()
        mocks.manager.reviewQueue.subscribe.mockClear()
    })

    afterEach(() => cleanup())

    it('shows the exact three package transactions before the one-time approval', () => {
        render(<SigningReviewDialog />)

        act(() => {
            mocks.state.listener?.({
                id: 'review-1',
                walletAddress: '0x1111111111111111111111111111111111111111',
                chainId: 56,
                chainName: 'BNB Smart Chain',
                origin: 'https://pistachioswap.com',
                action: 'Confirm Gas Assist swap',
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                payload: {
                    purpose: 'One-time authorization for this exact Gas Assist package',
                    orderId: 'order-123',
                    expiresAt: new Date(Date.now() + 60_000).toISOString(),
                    transactions: [
                        { action: 'fee-payment-transfer', destination: '0x2222222222222222222222222222222222222222', calldata: '0xaaaa' },
                        { action: 'token-approval', destination: '0x3333333333333333333333333333333333333333', calldata: '0xbbbb' },
                        { action: 'normal-swap', destination: '0x4444444444444444444444444444444444444444', calldata: '0xcccc' },
                    ],
                },
            })
        })

        expect(screen.getByRole('dialog', { name: 'Confirm Gas Assist swap' })).toBeTruthy()
        expect(screen.getByText('Exact package transactions')).toBeTruthy()
        expect(screen.getByText(/fee-payment-transfer/)).toBeTruthy()
        expect(screen.getByText(/token-approval/)).toBeTruthy()
        expect(screen.getByText(/normal-swap/)).toBeTruthy()
        expect(screen.getByText(/One approval and one passkey check authorize only the exact Gas Assist transactions listed above/)).toBeTruthy()
    })

    it('says the Gas Assist fee is already in the quote for an atomic self-call', () => {
        render(<SigningReviewDialog />)

        act(() => {
            mocks.state.listener?.({
                id: 'review-atomic',
                walletAddress: '0x1111111111111111111111111111111111111111',
                chainId: 56,
                chainName: 'BNB Smart Chain',
                origin: 'https://pistachioswap.com',
                action: 'Confirm Gas Assist swap',
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                payload: {
                    purpose: 'One sponsored BNB Chain transaction. The Gas Assist fee is already in the quote. If the swap fails, no fee is taken.',
                    orderId: 'order-atomic',
                    paymentAmountRaw: '1000',
                    authorization: '0x973731BE76BdB84B994D32eF1E9607edebfBE470',
                    destination: '0x1111111111111111111111111111111111111111',
                    calldata: '0x1234',
                },
            })
        })

        expect(screen.getByText('Gas Assist fee')).toBeTruthy()
        expect(screen.getByText(/Already included in the quote/)).toBeTruthy()
        expect(screen.getByText(/Explorers show this as To: Self/)).toBeTruthy()
        expect(screen.getByText(/temporarily runs the Gas Assist executor/)).toBeTruthy()
    })
})
