// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import SwapSettingsPopover from './SwapSettingsPopover.jsx'
import { DEFAULT_SWAP_SETTINGS } from '../../services/swapSettings.js'

function Harness() {
    const [settings, setSettings] = useState({ ...DEFAULT_SWAP_SETTINGS })
    return (
        <>
            <div data-testid="swap-card" style={{ width: '480px' }} />
            <SwapSettingsPopover
                settings={settings}
                onSettingsChange={setSettings}
                defaultSlippageBps={50}
            >
                <button type="button" aria-label="Swap settings">gear</button>
            </SwapSettingsPopover>
        </>
    )
}

describe('SwapSettingsPopover', () => {
    beforeEach(() => {
        globalThis.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
    })
    afterEach(cleanup)

    it('opens from the gear without resizing the swap card', () => {
        render(<Harness />)
        const card = screen.getByTestId('swap-card')
        expect(card.style.width).toBe('480px')
        fireEvent.click(screen.getByRole('button', { name: 'Swap settings' }))
        expect(screen.getByRole('dialog')).toBeTruthy()
        expect(card.style.width).toBe('480px')
        expect(screen.getByRole('button', { name: 'Use automatic slippage of 2.5%' }))
            .toBeTruthy()
    })

    it('accepts custom slippage and rejects malformed input', () => {
        render(<Harness />)
        fireEvent.click(screen.getByRole('button', { name: 'Swap settings' }))
        const input = screen.getByLabelText('Custom slippage percentage')
        fireEvent.change(input, { target: { value: '5.5' } })
        expect(input.getAttribute('aria-invalid')).toBe('false')
        fireEvent.change(input, { target: { value: 'bad' } })
        expect(input.value).toBe('5.5')
        expect(screen.queryByRole('alert')).toBeNull()
    })

    it('keeps custom slippage over 50 percent for the current page', () => {
        render(<Harness />)
        fireEvent.click(screen.getByRole('button', { name: 'Swap settings' }))
        const input = screen.getByLabelText('Custom slippage percentage')
        fireEvent.change(input, { target: { value: '60' } })
        expect(input.value).toBe('60')
        expect(input.getAttribute('aria-invalid')).toBe('false')
        fireEvent.click(screen.getByRole('button', { name: 'Swap settings' }))
        expect(screen.getByRole('button', {
            name: 'Swap settings, custom slippage 60%',
        })).toBeTruthy()
    })
})
