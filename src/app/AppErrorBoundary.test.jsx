// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import AppErrorBoundary from './AppErrorBoundary.jsx'

function BrokenComponent() {
    throw new Error('render failed')
}

afterEach(() => {
    vi.restoreAllMocks()
})

it('fails visibly without exposing the internal error and supports recovery', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()

    render(
        <AppErrorBoundary reload={reload}>
            <BrokenComponent />
        </AppErrorBoundary>,
    )

    expect(screen.getByRole('alert').textContent).toContain('PistachioSwap could not load')
    expect(screen.queryByText('render failed')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledOnce()
    expect(consoleError).toHaveBeenCalled()
})
