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

describe('Gas Assist quote details', () => {
    it('shows one exact same-chain Gas Assist fee without duplicated breakdown rows', () => {
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

        expect(screen.getByText('Gas Assist fee')).toBeTruthy()
        expect(screen.getByText('1 SELL ($1)')).toBeTruthy()
        expect(screen.queryByText('Gas Assist fee (all-in)')).toBeNull()
        expect(screen.queryByText('Network reserve (included)')).toBeNull()
        expect(screen.queryByText('PistachioSwap fee (included)')).toBeNull()
        expect(screen.queryByText('Network cost')).toBeNull()
    })

    it('shows only the sponsored Gas Assist fee instead of unsponsored cross-chain costs', () => {
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

        expect(screen.getByText('Gas Assist fee')).toBeTruthy()
        expect(screen.getByText('1 SELL ($1)')).toBeTruthy()
        expect(screen.queryByText('Gas Assist fee (included)')).toBeNull()
        expect(screen.queryByText('Estimated total cost')).toBeNull()
        expect(screen.queryByText('Estimated total cost (all-in)')).toBeNull()
        expect(screen.queryByText('Source network gas')).toBeNull()
        expect(screen.queryByText('$4')).toBeNull()
        expect(screen.queryByText('$1.50')).toBeNull()
    })

    it('does not display a meaningless zero sponsored amount', () => {
        render(<SwapDetails
            {...baseProps}
            mode="cross-chain"
            sameChain={{ visible: false }}
            crossChain={{
                route: { feeIncluded: true, durationSeconds: 30 },
                costs: { routeCostUsd: '0.23', sponsoredUsd: '0' },
                estimatedRouteCost: '$0.23',
                sourceGasCost: null,
                appFee: null,
                minimumReceived: '0.37 BUY',
                gasAssistFee: null,
            }}
        />)

        expect(screen.queryByText('Sponsored amount')).toBeNull()
    })
})
