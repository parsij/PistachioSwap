// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { GAS_ASSIST_LOW_NATIVE_BALANCE_MESSAGE } from '../../../services/swapExecutionMode.js'
import TransactionStatus from './TransactionStatus.jsx'

beforeAll(() => {
    globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
})

afterEach(cleanup)

describe('TransactionStatus', () => {
    it('keeps the low-BNB Gas Assist explanation compact behind an info control', () => {
        render(<TransactionStatus
            nativeBalanceError={false}
            nativeSymbol="BNB"
            executionMessage={GAS_ASSIST_LOW_NATIVE_BALANCE_MESSAGE}
            showExecutionMessage={false}
            statusMessage={null}
        />)

        expect(screen.getByText(GAS_ASSIST_LOW_NATIVE_BALANCE_MESSAGE)).toBeTruthy()
        const info = screen.getByRole('button', { name: 'Why Gas Assist needs BNB' })
        expect(screen.queryByRole('tooltip')).toBeNull()

        fireEvent.pointerEnter(info)
        expect(screen.getByRole('tooltip').textContent).toContain('Every blockchain transaction needs gas')
        expect(screen.getByRole('tooltip').textContent).toContain('On BNB Chain, gas is paid in BNB')
    })

    it('does not add the Gas Assist explanation to unrelated execution messages', () => {
        render(<TransactionStatus
            nativeBalanceError={false}
            nativeSymbol="BNB"
            executionMessage="Checking native BNB balance…"
            statusMessage={null}
        />)

        expect(screen.queryByRole('button', { name: 'Why Gas Assist needs BNB' })).toBeNull()
    })
})
