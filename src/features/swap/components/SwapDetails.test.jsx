// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SwapDetails from './SwapDetails.jsx'

const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    rate: '1 SELL = 2 BUY',
    slippage: { auto: true, label: '0.5%' },
    exactOutputMaximum: null,
}

afterEach(() => cleanup())

describe('all-in Gas Assist quote details', () => {
    it('shows the exact same-chain fee with included network and commercial breakdowns', () => {
        render(<SwapDetails
            {...baseProps}
            mode="same-chain"
            sameChain={{
                visible: true,
                serviceFee: '0.7 SELL',
                networkCost: '$0.30',
                gasAssistFee: {
                    totalToken: '1 SELL',
                    totalUsd: '$1',
                    networkReserveUsd: '$0.30',
                    commercialUsd: '$0.70',
                },
            }}
            crossChain={null}
        />)

        expect(screen.getByText('Gas Assist fee (all-in)')).toBeTruthy()
        expect(screen.getByText('1 SELL ($1)')).toBeTruthy()
        expect(screen.getByText('Network reserve (included)')).toBeTruthy()
        expect(screen.getByText('PistachioSwap fee (included)')).toBeTruthy()
        expect(screen.queryByText('Network cost')).toBeNull()
    })

    it('uses the sponsored all-in cross-chain cost instead of unsponsored source gas', () => {
        render(<SwapDetails
            {...baseProps}
            mode="cross-chain"
            sameChain={{ visible: false }}
            crossChain={{
                route: { feeIncluded: true, durationSeconds: 30 },
                costs: {},
                estimatedTotalCost: '$4',
                estimatedRouteCost: '$0.50',
                sourceGasCost: '$0.20',
                appFee: null,
                minimumReceived: '9 BUY',
                gasAssistFee: {
                    totalToken: '1 SELL',
                    totalUsd: '$1',
                    routeCostUsd: '$0.50',
                    allInCostUsd: '$1.50',
                    networkReserveUsd: '$0.30',
                },
            }}
        />)

        expect(screen.getByText('Estimated total cost (all-in)')).toBeTruthy()
        expect(screen.getByText('$1.50')).toBeTruthy()
        expect(screen.getByText('Gas Assist fee (included)')).toBeTruthy()
        expect(screen.queryByText('Source network gas')).toBeNull()
        expect(screen.queryByText('$4')).toBeNull()
    })
})
