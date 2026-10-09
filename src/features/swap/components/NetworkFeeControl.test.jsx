// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NetworkFeeControl from './NetworkFeeControl.jsx'
import { formatNetworkCostUsd } from '../model/swapDisplay.js'

const snapshot = { chainId: 10, type: 'eip1559', baseFeePerGas: 100n, observedAt: Date.now(), presets: {
    less: { maxFeePerGas: 150n, maxPriorityFeePerGas: 2n },
    standard: { maxFeePerGas: 200n, maxPriorityFeePerGas: 3n },
    high: { maxFeePerGas: 250n, maxPriorityFeePerGas: 8n },
} }
function setup(overrides = {}) {
    const onSelect = vi.fn()
    const fees = { chainId: 10, automatic: false, selection: { mode: 'standard', chainId: 10 }, snapshot,
        pendingNonce: 7, refreshNonce: vi.fn(), fields: snapshot.presets.standard, gasEstimate: 100000n, refresh: vi.fn(), ...overrides }
    render(<NetworkFeeControl fees={fees} nativePriceUsd="2000" onSelect={onSelect} sponsored={overrides.sponsored} destinationChainId={overrides.destinationChainId} />)
    return { fees, onSelect }
}
afterEach(cleanup)
describe('native network cost controls', () => {
    it('uses the source network and offers fee cards without a Pay with section', () => {
        const { onSelect } = setup()
        expect(screen.getByText('OP Mainnet')).toBeTruthy()
        expect(within(screen.getByRole('group', { name: 'Choose network cost' })).queryByText(/ETH max/)).toBeNull()
        expect(screen.getAllByText(/≈</).length).toBe(4)
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
        expect(within(screen.getByRole('group', { name: 'Choose network cost' })).queryByText(/CRO max/)).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
        expect(screen.getByLabelText('Gas price in Gwei')).toBeTruthy()
        expect(screen.queryByLabelText('Priority fee in Gwei')).toBeNull()
    })
    it('lets the user confirm the screenshot cheaper cap with a cost preview and a non-blocking warning', () => {
        const { onSelect } = setup({ chainId: 1, destinationChainId: 8453,
            snapshot: { ...snapshot, chainId: 1, baseFeePerGas: 128105061n } })
        fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
        fireEvent.change(screen.getByLabelText('Priority fee in Gwei'), { target: { value: '0.01' } })
        fireEvent.change(screen.getByLabelText('Max fee in Gwei'), { target: { value: '0.102553251' } })
        expect(screen.getByRole('status').textContent).toContain('below the current base fee')
        expect(within(screen.getByLabelText('Custom network cost estimate')).getByText('≈$0.02')).toBeTruthy()
        expect(screen.queryByRole('alert')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Confirm network cost' }))
        expect(onSelect).toHaveBeenCalledWith('custom', { maxFeePerGas: 102553251n, maxPriorityFeePerGas: 10000000n })
        expect(screen.queryByRole('dialog')).toBeNull()
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
    it('defaults to automatic, selects a pending nonce, validates integers and accepts zero', () => {
        const { onSelect, fees } = setup()
        fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
        const input = screen.getByLabelText('Transaction nonce')
        expect(input.value).toBe('')
        expect(fees.refreshNonce).toHaveBeenCalledOnce()
        expect(screen.getByText('Next pending nonce: 7')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Use pending nonce 7' }))
        expect(input.value).toBe('7')
        fireEvent.click(screen.getByRole('button', { name: 'Use automatic nonce' }))
        expect(input.value).toBe('')
        fireEvent.change(input, { target: { value: '1.5' } })
        fireEvent.click(screen.getByRole('button', { name: 'Confirm network cost' }))
        expect(screen.getByRole('alert').textContent).toContain('whole-number nonce')
        expect(onSelect).not.toHaveBeenCalled()
        fireEvent.change(input, { target: { value: '0' } })
        fireEvent.click(screen.getByRole('button', { name: 'Confirm network cost' }))
        expect(onSelect).toHaveBeenCalledWith('custom', { ...snapshot.presets.standard, nonce: 0 })
    })
    it('also supports custom nonces on legacy-fee networks', () => {
        const { onSelect } = setup({ chainId: 25, snapshot: { ...snapshot, chainId: 25, type: 'legacy', presets: {
            less: { gasPrice: 1n }, standard: { gasPrice: 2n }, high: { gasPrice: 3n },
        } } })
        fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
        fireEvent.change(screen.getByLabelText('Transaction nonce'), { target: { value: '9' } })
        fireEvent.click(screen.getByRole('button', { name: 'Confirm network cost' }))
        expect(onSelect).toHaveBeenCalledWith('custom', { gasPrice: 2n, nonce: 9 })
    })

    it.each([
        ['0', '$0.00'], ['0.034', '$0.03'], ['0.00005', '<$0.01'], ['0.004321', '<$0.01'],
        ['0.9999', '$1.00'], ['1', '$1.00'], ['1.2345', '$1.23'], [null, null], ['invalid', null],
    ])('formats network cost %s as %s without floating point loss', (value, expected) => {
        expect(formatNetworkCostUsd(value)).toBe(expected)
    })
    it('matches the reference dollar-and-cents cards with Gwei underneath and an editable custom estimate', () => {
        const presets = { less: { maxFeePerGas: 150000000n, maxPriorityFeePerGas: 2n },
            standard: { maxFeePerGas: 200000000n, maxPriorityFeePerGas: 3n },
            high: { maxFeePerGas: 250000000n, maxPriorityFeePerGas: 8n } }
        setup({ snapshot: { ...snapshot, presets }, fields: presets.standard })
        expect(within(screen.getByRole('button', { name: /Less/ })).getByText('≈$0.03')).toBeTruthy()
        expect(within(screen.getByRole('button', { name: /Standard/ })).getByText('≈$0.04')).toBeTruthy()
        expect(within(screen.getByRole('button', { name: /High/ })).getByText('≈$0.05')).toBeTruthy()
        expect(screen.getAllByText('≈$0.04')).toHaveLength(2)
        fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
        const preview = screen.getByLabelText('Custom network cost estimate')
        expect(within(preview).getByText('≈$0.04')).toBeTruthy()
        fireEvent.change(screen.getByLabelText('Max fee in Gwei'), { target: { value: '0.17' } })
        expect(within(preview).getByText('≈$0.03')).toBeTruthy()
        fireEvent.change(screen.getByLabelText('Max fee in Gwei'), { target: { value: '6' } })
        expect(within(preview).getByText('≈$1.20')).toBeTruthy()
    })

    it('identifies Base as the destination while editing Ethereum source fees', () => {
        setup({ chainId: 1, destinationChainId: 8453, snapshot: { ...snapshot, chainId: 1 } })
        expect(screen.getByText('Receiving on Base. Network cost settings apply to Ethereum.')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
        expect(screen.getByRole('dialog').textContent).toContain('Source: Ethereum. Destination: Base.')
        expect(screen.getByRole('dialog').textContent).toContain('These settings adjust the source transaction.')
    })

})
