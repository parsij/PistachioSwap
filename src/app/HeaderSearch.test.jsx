// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import HeaderSearch from './HeaderSearch.jsx'

afterEach(cleanup)

describe('HeaderSearch', () => {
    it('opens from the button and slash shortcut', () => {
        const onOpen = vi.fn()
        render(<HeaderSearch label="Search" onOpen={onOpen} />)

        fireEvent.click(screen.getByRole('button', { name: 'Search tokens' }))
        fireEvent.keyDown(window, { key: '/' })

        expect(onOpen).toHaveBeenCalledTimes(2)
    })

    it('does not steal slash while the user is typing', () => {
        const onOpen = vi.fn()
        render(
            <>
                <HeaderSearch label="Search" onOpen={onOpen} />
                <input aria-label="Amount" />
            </>,
        )

        const input = screen.getByRole('textbox', { name: 'Amount' })
        fireEvent.keyDown(input, { key: '/' })

        expect(onOpen).not.toHaveBeenCalled()
    })
})
