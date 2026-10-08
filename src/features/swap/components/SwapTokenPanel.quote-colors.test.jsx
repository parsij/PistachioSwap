// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SwapTokenPanel from './SwapTokenPanel.jsx'

vi.mock('./SwapTokenButton.jsx', () => ({
    AnimatedSwapTokenButton: () => <button type="button">Choose token</button>,
}))

afterEach(cleanup)

function panel(quoteReady) {
    return <SwapTokenPanel
        side="buy"
        label="Buy"
        token={null}
        chainId={56}
        amount={{ value: '2.5', denomination: 'TOKEN', onChange: () => {} }}
        secondaryValue="$2.50"
        layoutIdentity="quote-color-test"
        motionConfig={{ sharedLayout: { duration: 0 } }}
        onOpenTokenSelector={() => {}}
        onToggleDenomination={() => {}}
        quoteReady={quoteReady}
    />
}

describe('main swap quoted output text', () => {
    it('marks the buy amount as confirmed only while a quote is ready', () => {
        const { container, rerender } = render(panel(false))
        const buyPanel = container.querySelector('.buy-panel')
        expect(buyPanel?.hasAttribute('data-quote-ready')).toBe(false)
        expect(screen.getByRole('textbox', { name: 'Buy amount' }).value).toBe('2.5')

        rerender(panel(true))
        expect(buyPanel?.getAttribute('data-quote-ready')).toBe('true')

        rerender(panel(false))
        expect(buyPanel?.hasAttribute('data-quote-ready')).toBe(false)
    })

    it('keeps the white rules scoped to ready quotes with a muted placeholder', () => {
        const css = readFileSync(new URL('./SwapAmountInput.css', import.meta.url), 'utf8')
        expect(css).toMatch(/\.buy-panel\[data-quote-ready='true'\] \.buy-amount-input/u)
        expect(css).toMatch(/\.buy-panel\[data-quote-ready='true'\] \.buy-fiat-value/u)
        expect(css).toMatch(/color:\s*#fff/u)
        expect(css).toMatch(/\.buy-amount-input::placeholder/u)
    })
})
