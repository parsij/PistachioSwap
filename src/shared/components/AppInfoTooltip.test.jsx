// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import AppInfoTooltip from './AppInfoTooltip.jsx'

beforeAll(() => {
    globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
})

afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

describe('AppInfoTooltip', () => {
    it('stays open while moving from the icon to the explanation and closes after leaving both', () => {
        vi.useFakeTimers()
        render(
            <AppInfoTooltip ariaLabel="Gas information" icon={<span>i</span>}>
                Every transaction needs network gas.
            </AppInfoTooltip>,
        )

        const trigger = screen.getByRole('button', { name: 'Gas information' })
        fireEvent.pointerEnter(trigger)
        const tooltip = screen.getByRole('tooltip')
        expect(tooltip).toBeTruthy()

        fireEvent.pointerLeave(trigger)
        fireEvent.pointerEnter(tooltip)
        act(() => vi.advanceTimersByTime(100))
        expect(screen.getByRole('tooltip')).toBeTruthy()

        fireEvent.pointerLeave(tooltip)
        act(() => vi.advanceTimersByTime(100))
        expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('pins on click, ignores another click on the same icon, and closes on an outside click', () => {
        render(
            <div>
                <AppInfoTooltip ariaLabel="Gas information" icon={<span>i</span>}>
                    Every transaction needs network gas.
                </AppInfoTooltip>
                <button type="button">Outside</button>
            </div>,
        )

        const trigger = screen.getByRole('button', { name: 'Gas information' })
        fireEvent.click(trigger)
        const tooltip = screen.getByRole('tooltip')
        expect(tooltip).toBeTruthy()

        fireEvent.click(tooltip)
        expect(screen.getByRole('tooltip')).toBeTruthy()

        fireEvent.click(trigger)
        expect(screen.getByRole('tooltip')).toBeTruthy()

        fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
        expect(screen.queryByRole('tooltip')).toBeNull()
    })
})
