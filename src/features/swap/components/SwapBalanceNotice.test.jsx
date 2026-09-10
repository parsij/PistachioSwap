// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SwapBalanceNotice, {
    STALE_BALANCE_NOTICE_DELAY_MS,
} from './SwapBalanceNotice.jsx'

describe('wallet balance notice', () => {
    afterEach(() => {
        cleanup()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('renders nothing while balances are current', () => {
        const { container } = render(
            <SwapBalanceNotice notice={null} onRetry={vi.fn()} />,
        )
        expect(container.firstChild).toBeNull()
    })

    it('announces hard balance failures immediately and retries on request', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const onRetry = vi.fn()
        render(
            <SwapBalanceNotice
                notice="Wallet balances could not be loaded."
                onRetry={onRetry}
            />,
        )

        const status = screen.getByRole('status')
        expect(status.textContent)
            .toContain('Wallet balances could not be loaded.')
        expect(status.hidden).toBe(false)

        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('waits 6.7 seconds before showing previously loaded balances', () => {
        vi.useFakeTimers()
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        render(
            <SwapBalanceNotice
                notice="Showing previously loaded balances."
                onRetry={null}
            />,
        )

        expect(screen.queryByRole('status')).toBeNull()

        act(() => {
            vi.advanceTimersByTime(STALE_BALANCE_NOTICE_DELAY_MS - 1)
        })
        expect(screen.queryByRole('status')).toBeNull()

        act(() => {
            vi.advanceTimersByTime(1)
        })
        expect(screen.getByRole('status').textContent)
            .toContain('Showing previously loaded balances.')
        expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    })

    it('never flashes the cached-balance warning when fresh balances arrive before the delay', () => {
        vi.useFakeTimers()
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const view = render(
            <SwapBalanceNotice
                notice="Showing previously loaded balances."
                onRetry={null}
            />,
        )

        act(() => {
            vi.advanceTimersByTime(3_000)
        })
        view.rerender(<SwapBalanceNotice notice={null} onRetry={null} />)
        act(() => {
            vi.advanceTimersByTime(STALE_BALANCE_NOTICE_DELAY_MS)
        })

        expect(screen.queryByRole('status')).toBeNull()
    })
})
