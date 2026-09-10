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

describe('compact swap quote details', () => {
    it('shows one exact same-chain Gas Assist fee without duplicated rows', () => {
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
        expect(screen.queryByText('Estimated fee')).toBeNull()
        expect(screen.queryByText('Network cost')).toBeNull()
        expect(screen.queryByText('Route')).toBeNull()
    })

    it('shows one same-chain fee row instead of separate fee and network rows', () => {
        render(<SwapDetails
            {...baseProps}
            mode="same-chain"
            sameChain={{
                visible: true,
                serviceFee: '0.3 SELL (0.30%)',
                networkCost: '$0.03',
                gasAssistFee: null,
            }}
            crossChain={null}
        />)

        expect(screen.getByText('Estimated fee')).toBeTruthy()
        expect(screen.getAllByText('0.3 SELL (0.30%) + $0.03').length).toBeGreaterThan(0)
        expect(screen.queryByText('Fee')).toBeNull()
        expect(screen.queryByText('Network cost')).toBeNull()
        expect(screen.queryByText('Route')).toBeNull()
    })

    it('shows only the sponsored Gas Assist fee for cross-chain swaps', () => {
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
        expect(screen.queryByText('Estimated fee')).toBeNull()
        expect(screen.queryByText('Minimum received')).toBeNull()
        expect(screen.queryByText('Estimated arrival')).toBeNull()
        expect(screen.queryByText('$4')).toBeNull()
        expect(screen.queryByText('$1.50')).toBeNull()
    })

    it('shows one combined cross-chain fee without component, minimum, or arrival rows', () => {
        render(<SwapDetails
            {...baseProps}
            mode="cross-chain"
            sameChain={{ visible: false }}
            crossChain={{
                route: { feeIncluded: true, durationSeconds: 30 },
                costs: {
                    providerFeeUsd: '0.01',
                    destinationGasUsd: '0.02',
                    swapImpactUsd: '0.005',
                    sponsoredUsd: '0',
                },
                estimatedTotalCost: null,
                estimatedRouteCost: '~$0.03',
                sourceGasCost: null,
                appFee: '<$0.01',
                minimumReceived: '0.37 BUY',
                gasAssistFee: null,
            }}
        />)

        expect(screen.getByText('Estimated fee')).toBeTruthy()
        expect(screen.getAllByText('~$0.03').length).toBeGreaterThan(0)
        expect(screen.queryByText('Estimated route cost')).toBeNull()
        expect(screen.queryByText('Source network gas')).toBeNull()
        expect(screen.queryByText('Routing fee')).toBeNull()
        expect(screen.queryByText('Destination execution cost')).toBeNull()
        expect(screen.queryByText('Swap/route impact')).toBeNull()
        expect(screen.queryByText('PistachioSwap fee')).toBeNull()
        expect(screen.queryByText('Sponsored amount')).toBeNull()
        expect(screen.queryByText('Minimum received')).toBeNull()
        expect(screen.queryByText('Estimated arrival')).toBeNull()
    })
})
