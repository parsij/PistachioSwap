// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ImportAccountChooser from './ImportAccountChooser.jsx'
const root = '0x0000000000000000000000000000000000000001'
const second = '0x0000000000000000000000000000000000000002'
afterEach(cleanup)
it('shows full addresses and numbered wallet names and selects a nonzero index', () => {
    const onSelect = vi.fn()
    render(<ImportAccountChooser accounts={[{ index: 0, address: root }, { index: 1, address: second }]} selectedAddress={root} onSelect={onSelect} />)
    expect(screen.getByRole('radio', { name: `Pistachio Wallet 1 ${root}` }).checked).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: `Pistachio Wallet 2 ${second}` }))
    expect(onSelect).toHaveBeenCalledWith(1)
})
it('only searches a complete public address and disables account actions while busy', () => {
    const onFind = vi.fn(); const onMore = vi.fn()
    const props = { accounts: [{ index: 0, address: root }], selectedAddress: root, onFind, onMore }
    const view = render(<ImportAccountChooser {...props} />)
    fireEvent.change(screen.getByLabelText('Expected wallet address'), { target: { value: 'Ca' } })
    expect(screen.getByRole('button', { name: 'Find wallet' }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Expected wallet address'), { target: { value: second } })
    fireEvent.click(screen.getByRole('button', { name: 'Find wallet' }))
    expect(onFind).toHaveBeenCalledWith(second)
    fireEvent.click(screen.getByRole('button', { name: 'Show more wallets' }))
    expect(onMore).toHaveBeenCalledWith(11)
    view.rerender(<ImportAccountChooser {...props} busy />)
    expect(screen.getByRole('button', { name: 'Find wallet' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Show more wallets' }).disabled).toBe(true)
})
