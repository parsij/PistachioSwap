// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import CrossChainRouteCards from './CrossChainRouteCards.jsx'

it('uses native toggle-button semantics for route selection', () => {
    const routes = [
        {
            publicRouteId: 'relay-route',
            provider: 'relay',
            outputAmount: '967660',
            durationSeconds: 30,
            destinationAsset: { decimals: 6, symbol: 'USDC' },
        },
        {
            publicRouteId: 'across-route',
            provider: 'across',
            outputAmount: '960000',
            durationSeconds: 60,
            destinationAsset: { decimals: 6, symbol: 'USDC' },
        },
    ]

    render(
        <CrossChainRouteCards
            routes={routes}
            sort="return"
            onSortChange={vi.fn()}
            onSelect={vi.fn()}
            recommendedRouteId="relay-route"
            selectedRouteId="relay-route"
        />,
    )

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.getByRole('button', { name: 'Select Relay route' }).getAttribute('aria-pressed'))
        .toBe('true')
    expect(screen.getByRole('button', { name: 'Select Across route' }).getAttribute('aria-pressed'))
        .toBe('false')
})
