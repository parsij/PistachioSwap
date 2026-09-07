// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import SwapAmountInput from './SwapAmountInput.jsx'

describe('SwapAmountInput', () => {
    it('shows a rounded amount while idle and the exact value while focused', () => {
        const exact = '0.00529963167546908'
        const { container } = render(
            <SwapAmountInput
                value={exact}
                denomination="TOKEN"
                label="Sell"
                className="sell-amount-input"
                onChange={() => {}}
            />,
        )
        const input = screen.getByRole('textbox', { name: 'Sell amount' })
        const shell = container.querySelector('.amount-input-shell')
        expect(input.value).toBe('0.0053')
        expect(shell.classList.contains('amount-input-compact')).toBe(false)
        expect(shell.classList.contains('amount-input-dense')).toBe(false)

        fireEvent.focus(input)
        expect(input.value).toBe(exact)
        expect(shell.classList.contains('amount-input-dense')).toBe(true)
        fireEvent.blur(input)
        expect(input.value).toBe('0.0053')
        expect(shell.classList.contains('amount-input-dense')).toBe(false)
    })

    it('shrinks only long displayed values, not normal amounts', () => {
        const { container, rerender } = render(
            <SwapAmountInput
                value="1234567890123"
                denomination="TOKEN"
                label="Sell"
                className="sell-amount-input"
                onChange={() => {}}
            />,
        )
        expect(container.querySelector('.amount-input-shell').classList.contains('amount-input-compact'))
            .toBe(true)

        rerender(
            <SwapAmountInput
                value="879"
                denomination="TOKEN"
                label="Sell"
                className="sell-amount-input"
                onChange={() => {}}
            />,
        )
        const shell = container.querySelector('.amount-input-shell')
        expect(shell.classList.contains('amount-input-compact')).toBe(false)
        expect(shell.classList.contains('amount-input-dense')).toBe(false)
    })

    it('rounds idle USD amounts to cents', () => {
        render(
            <SwapAmountInput
                value="0.6898962376"
                denomination="USD"
                label="Sell"
                className="sell-amount-input"
                onChange={() => {}}
            />,
        )
        expect(screen.getByRole('textbox', { name: 'Sell USD amount' }).value).toBe('0.69')
    })
})
