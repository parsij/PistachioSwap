// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NetworkFeeControl from './NetworkFeeControl.jsx'

const snapshot = { chainId: 10, type: 'eip1559', baseFeePerGas: 100n, observedAt: Date.now(), presets: {
    less: { maxFeePerGas: 150n, maxPriorityFeePerGas: 2n },
    standard: { maxFeePerGas: 200n, maxPriorityFeePerGas: 3n },
    high: { maxFeePerGas: 250n, maxPriorityFeePerGas: 8n },
} }
function setup(overrides = {}) {
    const onSelect = vi.fn()
    const fees = { chainId: 10, automatic: false, selection: { mode: 'standard', chainId: 10 }, snapshot,
        fields: snapshot.presets.standard, gasEstimate: 100000n, refresh: vi.fn(), ...overrides }
    render(<NetworkFeeControl fees={fees} nativePriceUsd="2000" onSelect={onSelect} sponsored={overrides.sponsored} />)
    return { fees, onSelect }
}
afterEach(cleanup)
describe('native network cost controls', () => {
    it('uses the source network and offers fee cards without a Pay with section', () => {
        const { onSelect } = setup()
        expect(screen.getByText('OP Mainnet')).toBeTruthy()
        expect(screen.getAllByText(/ETH max/).length).toBe(3)
        expect(screen.queryByText(/Pay with/)).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: /High/ }))
        expect(onSelect).toHaveBeenCalledWith('high')
    })
    it('opens live recommendations, rejects invalid fees, and applies exact wei values', () => {
        const { onSelect } = setup()
        fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
        expect(screen.getByRole('dialog').textContent).toContain('Recommended: 0.000000003 Gwei')
        fireEvent.change(screen.getByLabelText('Priority fee in Gwei'), { target: { value: '0.1' } })
        fireEvent.change(screen.getByLabelText('Max fee in Gwei'), { target: { value: '0.01' } })
        fireEvent.click(screen.getByRole('button', { name: 'Confirm network cost' }))
        expect(screen.getByRole('alert').textContent).toContain('Priority fee cannot exceed')
        expect(onSelect).not.toHaveBeenCalled()
        fireEvent.change(screen.getByLabelText('Max fee in Gwei'), { target: { value: '0.2' } })
        fireEvent.click(screen.getByRole('button', { name: 'Confirm network cost' }))
        expect(onSelect).toHaveBeenCalledWith('custom', { maxPriorityFeePerGas: 100000000n, maxFeePerGas: 200000000n })
        expect(screen.queryByRole('dialog')).toBeNull()
    })
    it('renders a legacy gas price editor and the chain native token', () => {
        setup({ chainId: 25, snapshot: { ...snapshot, chainId: 25, type: 'legacy', presets: { less: { gasPrice: 1n }, standard: { gasPrice: 2n }, high: { gasPrice: 3n } } } })
        expect(screen.getAllByText(/CRO max/).length).toBe(3)
        fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
        expect(screen.getByLabelText('Gas price in Gwei')).toBeTruthy()
        expect(screen.queryByLabelText('Priority fee in Gwei')).toBeNull()
    })
    it('keeps automatic and sponsored controls separate and handles missing estimates', () => {
        setup({ automatic: true })
        expect(screen.getByText(/Turn off Auto network cost/)).toBeTruthy()
        expect(screen.queryByRole('button', { name: /Custom/ })).toBeNull()
        cleanup()
        setup({ sponsored: true })
        expect(screen.getByText(/Gas Assist manages/)).toBeTruthy()
        expect(screen.queryByRole('group')).toBeNull()
        cleanup()
        setup({ snapshot: null, fields: null, error: 'RPC unavailable' })
        expect(screen.getByRole('alert').textContent).toBe('RPC unavailable')
        expect(screen.getByRole('button', { name: /Custom/ }).disabled).toBe(true)
    })
})
